"""
Quota service for managing user quotas and usage tracking.
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import and_

from aperag.db.models import UserQuota, User
from aperag.db.ops import get_db_session
from aperag.exceptions import QuotaExceededException, NotFoundException


class QuotaService:
    """Service for managing user quotas."""
    
    @staticmethod
    def get_user_quotas(user_id: str, db: Optional[Session] = None) -> List[UserQuota]:
        """Get all quotas for a user."""
        if db is None:
            db = get_db_session()
        
        quotas = db.query(UserQuota).filter(UserQuota.user_id == user_id).all()
        return quotas
    
    @staticmethod
    def get_user_quota(user_id: str, quota_type: str, db: Optional[Session] = None) -> Optional[UserQuota]:
        """Get a specific quota for a user."""
        if db is None:
            db = get_db_session()
        
        quota = db.query(UserQuota).filter(
            and_(UserQuota.user_id == user_id, UserQuota.quota_type == quota_type)
        ).first()
        return quota
    
    @staticmethod
    def check_quota_available(user_id: str, quota_type: str, required_amount: int = 1, db: Optional[Session] = None) -> bool:
        """Check if user has enough quota available."""
        quota = QuotaService.get_user_quota(user_id, quota_type, db)
        if not quota:
            return False
        
        return quota.current_usage + required_amount <= quota.quota_limit
    
    @staticmethod
    def consume_quota(user_id: str, quota_type: str, amount: int = 1, db: Optional[Session] = None) -> UserQuota:
        """
        Consume quota for a user. This method ensures atomicity and quota limits.
        Raises QuotaExceededException if quota would be exceeded.
        """
        if db is None:
            db = get_db_session()
        
        # Use SELECT FOR UPDATE to prevent race conditions
        quota = db.query(UserQuota).filter(
            and_(UserQuota.user_id == user_id, UserQuota.quota_type == quota_type)
        ).with_for_update().first()
        
        if not quota:
            raise NotFoundException(f"Quota {quota_type} not found for user {user_id}")
        
        # Check if consuming this amount would exceed the limit
        if quota.current_usage + amount > quota.quota_limit:
            raise QuotaExceededException(
                f"Quota exceeded: {quota_type} limit is {quota.quota_limit}, "
                f"current usage is {quota.current_usage}, requested amount is {amount}"
            )
        
        # Update usage
        quota.current_usage += amount
        db.commit()
        db.refresh(quota)
        
        return quota
    
    @staticmethod
    def release_quota(user_id: str, quota_type: str, amount: int = 1, db: Optional[Session] = None) -> UserQuota:
        """Release quota for a user (decrease usage)."""
        if db is None:
            db = get_db_session()
        
        # Use SELECT FOR UPDATE to prevent race conditions
        quota = db.query(UserQuota).filter(
            and_(UserQuota.user_id == user_id, UserQuota.quota_type == quota_type)
        ).with_for_update().first()
        
        if not quota:
            raise NotFoundException(f"Quota {quota_type} not found for user {user_id}")
        
        # Ensure we don't go below 0
        quota.current_usage = max(0, quota.current_usage - amount)
        db.commit()
        db.refresh(quota)
        
        return quota
    
    @staticmethod
    def update_quota_limit(user_id: str, quota_type: str, new_limit: int, db: Optional[Session] = None) -> UserQuota:
        """Update quota limit for a user."""
        if db is None:
            db = get_db_session()
        
        quota = db.query(UserQuota).filter(
            and_(UserQuota.user_id == user_id, UserQuota.quota_type == quota_type)
        ).first()
        
        if not quota:
            raise NotFoundException(f"Quota {quota_type} not found for user {user_id}")
        
        quota.quota_limit = new_limit
        db.commit()
        db.refresh(quota)
        
        return quota
    
    @staticmethod
    def recalculate_usage(user_id: str, db: Optional[Session] = None) -> List[UserQuota]:
        """Recalculate actual usage for all quotas of a user."""
        if db is None:
            db = get_db_session()
        
        from aperag.db.models import Collection, Document, Bot
        
        quotas = QuotaService.get_user_quotas(user_id, db)
        
        for quota in quotas:
            if quota.quota_type == "max_collection_count":
                # Count collections owned by user
                actual_usage = db.query(Collection).filter(Collection.owner_id == user_id).count()
            elif quota.quota_type == "max_document_count":
                # Count all documents in user's collections
                actual_usage = db.query(Document).join(Collection).filter(Collection.owner_id == user_id).count()
            elif quota.quota_type == "max_document_count_per_collection":
                # This is a per-collection limit, so we don't recalculate total usage
                continue
            elif quota.quota_type == "max_bot_count":
                # Count bots owned by user
                actual_usage = db.query(Bot).filter(Bot.owner_id == user_id).count()
            else:
                continue
            
            quota.current_usage = actual_usage
        
        db.commit()
        return quotas
    
    @staticmethod
    def initialize_user_quotas(user_id: str, db: Optional[Session] = None) -> List[UserQuota]:
        """Initialize default quotas for a new user."""
        if db is None:
            db = get_db_session()
        
        # Default quota limits (these could be configurable)
        default_quotas = {
            "max_collection_count": 10,
            "max_document_count": 1000,
            "max_document_count_per_collection": 100,
            "max_bot_count": 5,
        }
        
        quotas = []
        for quota_type, limit in default_quotas.items():
            # Check if quota already exists
            existing_quota = QuotaService.get_user_quota(user_id, quota_type, db)
            if not existing_quota:
                quota = UserQuota(
                    user_id=user_id,
                    quota_type=quota_type,
                    quota_limit=limit,
                    current_usage=0
                )
                db.add(quota)
                quotas.append(quota)
        
        db.commit()
        return quotas
    
    @staticmethod
    def get_all_users_quotas(db: Optional[Session] = None) -> List[dict]:
        """Get quotas for all users (admin only)."""
        if db is None:
            db = get_db_session()
        
        # Get all users with their quotas
        users = db.query(User).all()
        result = []
        
        for user in users:
            quotas = QuotaService.get_user_quotas(user.id, db)
            result.append({
                "user_id": user.id,
                "username": user.username,
                "email": user.email,
                "role": user.role,
                "quotas": quotas
            })
        
        return result
