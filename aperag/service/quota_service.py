"""
Quota service for managing user quotas and usage tracking.
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import and_

from aperag.db.models import UserQuota, User
from aperag.config import get_sync_session
from aperag.exceptions import QuotaExceededException, NotFoundException


class QuotaService:
    """Service for managing user quotas."""
    
    def get_user_quotas(self, user_id: str, session: Optional[Session] = None) -> List[UserQuota]:
        """Get all quotas for a user."""
        if session is None:
            for item in get_sync_session():
                session = item
                break
        
        quotas = session.query(UserQuota).filter(UserQuota.user == user_id).all()
        return quotas
    
    def get_user_quota(self, user_id: str, quota_type: str, session: Optional[Session] = None) -> Optional[UserQuota]:
        """Get a specific quota for a user."""
        if session is None:
            for item in get_sync_session():
                session = item
                break
        
        quota = session.query(UserQuota).filter(
            and_(UserQuota.user == user_id, UserQuota.quota_type == quota_type)
        ).first()
        return quota
    
    def check_quota_available(self, user_id: str, quota_type: str, required_amount: int = 1, session: Optional[Session] = None) -> bool:
        """Check if user has enough quota available."""
        quota = self.get_user_quota(user_id, quota_type, session)
        if not quota:
            return False
        
        return quota.current_usage + required_amount <= quota.quota_limit
    
    def consume_quota(self, user_id: str, quota_type: str, amount: int = 1, session: Optional[Session] = None) -> UserQuota:
        """
        Consume quota for a user. This method ensures atomicity and quota limits.
        Raises QuotaExceededException if quota would be exceeded.
        """
        if session is None:
            for item in get_sync_session():
                session = item
                break
        
        # Use SELECT FOR UPDATE to prevent race conditions
        quota = session.query(UserQuota).filter(
            and_(UserQuota.user == user_id, UserQuota.quota_type == quota_type)
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
        session.commit()
        session.refresh(quota)
        
        return quota
    
    def release_quota(self, user_id: str, quota_type: str, amount: int = 1, session: Optional[Session] = None) -> UserQuota:
        """Release quota for a user (decrease usage)."""
        if session is None:
            for item in get_sync_session():
                session = item
                break
        
        # Use SELECT FOR UPDATE to prevent race conditions
        quota = session.query(UserQuota).filter(
            and_(UserQuota.user == user_id, UserQuota.quota_type == quota_type)
        ).with_for_update().first()
        
        if not quota:
            raise NotFoundException(f"Quota {quota_type} not found for user {user_id}")
        
        # Ensure we don't go below 0
        quota.current_usage = max(0, quota.current_usage - amount)
        session.commit()
        session.refresh(quota)
        
        return quota
    
    def update_quota_limit(self, user_id: str, quota_type: str, new_limit: int, session: Optional[Session] = None) -> UserQuota:
        """Update quota limit for a user."""
        if session is None:
            for item in get_sync_session():
                session = item
                break
        
        quota = session.query(UserQuota).filter(
            and_(UserQuota.user == user_id, UserQuota.quota_type == quota_type)
        ).first()
        
        if not quota:
            raise NotFoundException(f"Quota {quota_type} not found for user {user_id}")
        
        quota.quota_limit = new_limit
        session.commit()
        session.refresh(quota)
        
        return quota
    
    def recalculate_usage(self, user_id: str, session: Optional[Session] = None) -> List[UserQuota]:
        """Recalculate actual usage for all quotas of a user."""
        if session is None:
            for item in get_sync_session():
                session = item
                break
        
        from aperag.db.models import Collection, Document, Bot
        
        quotas = self.get_user_quotas(user_id, session)
        
        for quota in quotas:
            if quota.quota_type == "max_collection_count":
                # Count collections owned by user
                actual_usage = session.query(Collection).filter(Collection.owner_id == user_id).count()
            elif quota.quota_type == "max_document_count":
                # Count all documents in user's collections
                actual_usage = session.query(Document).join(Collection).filter(Collection.owner_id == user_id).count()
            elif quota.quota_type == "max_document_count_per_collection":
                # This is a per-collection limit, so we don't recalculate total usage
                continue
            elif quota.quota_type == "max_bot_count":
                # Count bots owned by user
                actual_usage = session.query(Bot).filter(Bot.owner_id == user_id).count()
            else:
                continue
            
            quota.current_usage = actual_usage
        
        session.commit()
        return quotas
    
    def initialize_user_quotas(self, user_id: str, session: Optional[Session] = None) -> List[UserQuota]:
        """Initialize default quotas for a new user."""
        if session is None:
            for item in get_sync_session():
                session = item
                break
        
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
            existing_quota = self.get_user_quota(user_id, quota_type, session)
            if not existing_quota:
                quota = UserQuota(
                    user_id=user_id,
                    quota_type=quota_type,
                    quota_limit=limit,
                    current_usage=0
                )
                session.add(quota)
                quotas.append(quota)
        
        session.commit()
        return quotas
    
    def get_all_users_quotas(self, session: Optional[Session] = None) -> List[dict]:
        """Get quotas for all users (admin only)."""
        if session is None:
            for item in get_sync_session():
                session = item
                break
        
        # Get all users with their quotas
        users = session.query(User).all()
        result = []
        
        for user in users:
            quotas = self.get_user_quotas(user.id, session)
            result.append({
                "user_id": user.id,
                "username": user.username,
                "email": user.email,
                "role": user.role,
                "quotas": quotas
            })
        
        return result

quota_service = QuotaService()
