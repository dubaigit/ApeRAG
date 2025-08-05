# ApeRAG DigitalOcean Deployment Guide

This guide provides step-by-step instructions for deploying ApeRAG on DigitalOcean.

## Prerequisites

- DigitalOcean account
- Domain name (optional, for SSL)
- SSH key configured

## Step 1: Create a Droplet

1. Log in to DigitalOcean
2. Create a new Droplet with these specifications:
   - **Image**: Ubuntu 22.04 LTS
   - **Plan**: Minimum 4GB RAM, 2 vCPUs (Basic $24/month or higher)
   - **Datacenter**: Choose closest to your users
   - **Authentication**: SSH keys (recommended)
   - **Hostname**: `aperag-server`

## Step 2: Initial Server Setup

SSH into your droplet:
```bash
ssh root@your-droplet-ip
```

Run the deployment script:
```bash
# Download and run the deployment script
curl -O https://raw.githubusercontent.com/your-username/ApeRAG/main/deploy-digitalocean.sh
chmod +x deploy-digitalocean.sh
sudo ./deploy-digitalocean.sh
```

## Step 3: Configure Environment

Edit the environment file:
```bash
sudo nano /opt/aperag/ApeRAG/.env
```

Update these critical values:
- `OPENAI_API_KEY`: Your OpenAI API key
- `ANTHROPIC_API_KEY`: Your Anthropic API key (if using Claude)
- `POSTGRES_PASSWORD`: Generate a secure password
- `REDIS_PASSWORD`: Generate a secure password
- `ELASTIC_PASSWORD`: Generate a secure password

## Step 4: Start Services

```bash
# Start all services
sudo systemctl start aperag

# Check status
sudo systemctl status aperag

# View logs
cd /opt/aperag/ApeRAG
sudo docker-compose logs -f
```

## Step 5: Access ApeRAG

Your ApeRAG instance is now accessible at:
- Web Interface: `http://your-droplet-ip:3000`
- API Documentation: `http://your-droplet-ip:8000/docs`

## Step 6: Configure Domain & SSL (Optional)

1. Point your domain to the droplet IP
2. Install SSL certificate:
```bash
sudo certbot --nginx -d your-domain.com
```

## Monitoring & Maintenance

### Check Service Status
```bash
sudo /opt/aperag/monitor.sh
```

### View Logs
```bash
# All services
cd /opt/aperag/ApeRAG
sudo docker-compose logs -f

# Specific service
sudo docker-compose logs -f api
```

### Backup Data
Automatic backups run daily at 2 AM. Manual backup:
```bash
sudo /opt/aperag/backup.sh
```

### Update ApeRAG
```bash
cd /opt/aperag/ApeRAG
git pull
sudo docker-compose down
sudo docker-compose up -d --build
```

## Resource Requirements

- **Minimum**: 4GB RAM, 2 vCPUs, 50GB SSD
- **Recommended**: 8GB RAM, 4 vCPUs, 100GB SSD
- **With GPU parsing**: 16GB RAM, 8 vCPUs, 200GB SSD

## Troubleshooting

### Service Won't Start
```bash
# Check logs
sudo journalctl -u aperag -n 50

# Check Docker
sudo docker ps -a
```

### Database Connection Issues
```bash
# Test PostgreSQL
sudo docker exec -it postgres psql -U aperag -d aperag

# Test Redis
sudo docker exec -it redis redis-cli ping
```

### Out of Memory
```bash
# Check memory usage
free -h

# Restart services
sudo docker-compose restart
```

## Security Recommendations

1. **Firewall**: Already configured by the script
2. **Updates**: Enable automatic security updates
3. **Backups**: Verify daily backups are running
4. **Monitoring**: Set up external monitoring (UptimeRobot, etc.)
5. **API Keys**: Use environment-specific keys, never commit to git

## Support

For issues or questions:
- Check logs first: `sudo docker-compose logs`
- GitHub Issues: https://github.com/apecloud/ApeRAG/issues
- Documentation: https://github.com/apecloud/ApeRAG/docs