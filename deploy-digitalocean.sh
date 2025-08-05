#!/bin/bash

# ApeRAG DigitalOcean Deployment Script
# This script sets up ApeRAG on a fresh Ubuntu droplet

set -e  # Exit on error

echo "==================================="
echo "ApeRAG DigitalOcean Deployment"
echo "==================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run as root (use sudo)"
    exit 1
fi

# Update system
print_status "Updating system packages..."
apt-get update && apt-get upgrade -y

# Install required packages
print_status "Installing required packages..."
apt-get install -y \
    curl \
    git \
    ufw \
    nginx \
    certbot \
    python3-certbot-nginx \
    htop \
    ncdu \
    net-tools

# Install Docker
if ! command -v docker &> /dev/null; then
    print_status "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    print_status "Docker already installed"
fi

# Install Docker Compose
if ! command -v docker-compose &> /dev/null; then
    print_status "Installing Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    print_status "Docker Compose already installed"
fi

# Configure firewall
print_status "Configuring firewall..."
ufw --force enable
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp  # Frontend port
ufw allow 8000/tcp  # API port

# Create aperag user
if ! id -u aperag &>/dev/null; then
    print_status "Creating aperag user..."
    useradd -m -s /bin/bash aperag
    usermod -aG docker aperag
else
    print_status "User aperag already exists"
fi

# Create directory structure
print_status "Creating directory structure..."
mkdir -p /opt/aperag
mkdir -p /opt/aperag/data/{postgres,redis,elasticsearch,neo4j,qdrant,docray}
mkdir -p /opt/aperag/logs
mkdir -p /opt/aperag/backups

# Set permissions
chown -R aperag:aperag /opt/aperag

# Clone repository
if [ ! -d "/opt/aperag/ApeRAG" ]; then
    print_status "Cloning ApeRAG repository..."
    cd /opt/aperag
    git clone https://github.com/apecloud/ApeRAG.git
    chown -R aperag:aperag ApeRAG
else
    print_status "Repository already exists, pulling latest changes..."
    cd /opt/aperag/ApeRAG
    git pull
fi

cd /opt/aperag/ApeRAG

# Create production environment file
print_status "Creating production environment configuration..."
cat > .env.production << 'EOF'
# Database Configuration
POSTGRES_DB=aperag
POSTGRES_USER=aperag
POSTGRES_PASSWORD=$(openssl rand -base64 32)
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

# Redis Configuration
REDIS_PASSWORD=$(openssl rand -base64 32)
REDIS_HOST=redis
REDIS_PORT=6379

# Elasticsearch Configuration
ELASTIC_PASSWORD=$(openssl rand -base64 32)
ELASTICSEARCH_HOST=elasticsearch
ELASTICSEARCH_PORT=9200

# API Configuration
APERAG_API_KEY=$(openssl rand -base64 32)
APERAG_SECRET_KEY=$(openssl rand -base64 32)
APERAG_ALGORITHM=HS256
APERAG_ACCESS_TOKEN_EXPIRE_MINUTES=30

# Frontend Configuration
REACT_APP_API_URL=http://localhost:8000

# Celery Configuration
CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/0

# Object Storage
OBJECT_STORAGE_TYPE=local
OBJECT_STORAGE_LOCAL_PATH=/data/storage

# LLM Configuration (Update with your API keys)
OPENAI_API_KEY=your-openai-api-key-here
ANTHROPIC_API_KEY=your-anthropic-api-key-here

# MinerU Token (Optional, for enhanced document parsing)
MINERU_TOKEN=

# Monitoring
ENABLE_TELEMETRY=false
EOF

# Copy environment files
cp .env.production .env
cp frontend/deploy/env.local.template frontend/.env

# Create docker-compose override for production
print_status "Creating production docker-compose configuration..."
cat > docker-compose.prod.yml << 'EOF'
version: '3.8'

services:
  postgres:
    restart: always
    volumes:
      - /opt/aperag/data/postgres:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password
    secrets:
      - postgres_password

  redis:
    restart: always
    volumes:
      - /opt/aperag/data/redis:/data
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}

  elasticsearch:
    restart: always
    volumes:
      - /opt/aperag/data/elasticsearch:/usr/share/elasticsearch/data
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=true
      - ELASTIC_PASSWORD=${ELASTIC_PASSWORD}

  api:
    restart: always
    environment:
      - ENVIRONMENT=production
    volumes:
      - /opt/aperag/logs:/app/logs

  frontend:
    restart: always
    environment:
      - NODE_ENV=production

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - api
      - frontend

secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt
EOF

# Create secrets directory
mkdir -p secrets
echo "$(openssl rand -base64 32)" > secrets/postgres_password.txt
chmod 600 secrets/postgres_password.txt

# Create nginx configuration
print_status "Creating nginx configuration..."
cat > nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream api {
        server api:8000;
    }

    upstream frontend {
        server frontend:3000;
    }

    server {
        listen 80;
        server_name _;

        location /api {
            proxy_pass http://api;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location / {
            proxy_pass http://frontend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
EOF

# Create systemd service
print_status "Creating systemd service..."
cat > /etc/systemd/system/aperag.service << 'EOF'
[Unit]
Description=ApeRAG Service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/aperag/ApeRAG
ExecStart=/usr/local/bin/docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
User=aperag
Group=aperag

[Install]
WantedBy=multi-user.target
EOF

# Create backup script
print_status "Creating backup script..."
cat > /opt/aperag/backup.sh << 'EOF'
#!/bin/bash
# ApeRAG Backup Script

BACKUP_DIR="/opt/aperag/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="aperag_backup_${DATE}"

# Create backup directory
mkdir -p "${BACKUP_DIR}/${BACKUP_NAME}"

# Backup PostgreSQL
docker exec postgres pg_dumpall -U aperag > "${BACKUP_DIR}/${BACKUP_NAME}/postgres.sql"

# Backup Redis
docker exec redis redis-cli --rdb "${BACKUP_DIR}/${BACKUP_NAME}/redis.rdb"

# Backup Elasticsearch
docker exec elasticsearch elasticsearch-node repurpose

# Backup data directories
tar -czf "${BACKUP_DIR}/${BACKUP_NAME}/data.tar.gz" /opt/aperag/data

# Keep only last 7 days of backups
find "${BACKUP_DIR}" -type d -name "aperag_backup_*" -mtime +7 -exec rm -rf {} \;

echo "Backup completed: ${BACKUP_NAME}"
EOF

chmod +x /opt/aperag/backup.sh

# Create monitoring script
print_status "Creating monitoring script..."
cat > /opt/aperag/monitor.sh << 'EOF'
#!/bin/bash
# ApeRAG Monitoring Script

# Check if all services are running
services=("postgres" "redis" "elasticsearch" "api" "frontend" "celeryworker" "celerybeat")

for service in "${services[@]}"; do
    if docker ps | grep -q "$service"; then
        echo "✓ $service is running"
    else
        echo "✗ $service is not running"
        # Try to restart the service
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d $service
    fi
done

# Check disk usage
df -h | grep -E '^/dev/' | awk '{ if(int($5) > 80) print "Warning: " $1 " is " $5 " full" }'

# Check memory usage
free -m | awk 'NR==2{printf "Memory Usage: %s/%sMB (%.2f%%)\n", $3,$2,$3*100/$2 }'
EOF

chmod +x /opt/aperag/monitor.sh

# Add cron jobs
print_status "Setting up cron jobs..."
cat > /etc/cron.d/aperag << 'EOF'
# ApeRAG Maintenance Jobs
0 2 * * * aperag /opt/aperag/backup.sh >> /opt/aperag/logs/backup.log 2>&1
*/5 * * * * aperag /opt/aperag/monitor.sh >> /opt/aperag/logs/monitor.log 2>&1
EOF

# Enable and start service
print_status "Enabling ApeRAG service..."
systemctl daemon-reload
systemctl enable aperag

print_status "Deployment script completed!"
print_warning "Next steps:"
echo "1. Edit /opt/aperag/ApeRAG/.env to add your API keys"
echo "2. Start the service: systemctl start aperag"
echo "3. Check status: systemctl status aperag"
echo "4. View logs: docker-compose logs -f"
echo "5. Access ApeRAG at: http://your-server-ip"
echo ""
echo "For SSL/HTTPS setup, run:"
echo "certbot --nginx -d your-domain.com"