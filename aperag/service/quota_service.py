# Copyright 2025 ApeCloud, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Quota service for managing user quotas and usage tracking.
"""
import logging
from typing import Dict, List, Optional

from aperag.db.ops import AsyncDatabaseOps, async_db_ops
from aperag.exceptions import QuotaExceededException

logger = logging.getLogger(__name__)


class QuotaService:
    """Service for managing user quotas."""
    
    def __init__(self, db_ops: AsyncDatabaseOps = None):
        self.db_ops = db_ops or async_db_ops

    async def get_user_quotas(self, user_id: str) -> Dict[str, Dict[str, int]]:
        """Get all quotas for a user as a dictionary."""
        async def _query(session):
            from aperag.db.models import UserQuota
            from sqlalchemy import select
            
            stmt = select(UserQuota).where(UserQuota.user == user_id)
            result = await session.execute(stmt)
            quotas = result.scalars().all()
            
            quota_dict = {}
            for quota in quotas:
                quota_dict[quota.key] = {
                    'quota_limit': quota.quota_limit,
                    'current_usage': quota.current_usage,
                    'remaining': max(0, quota.quota_limit - quota.current_usage)
                }
            
            return quota_dict
        
        return await self.db_ops._execute_query(_query)

    async def get_all_users_quotas(self) -> List[Dict]:
        """Get quotas for all users (admin only)."""
        async def _query(session):
            from aperag.db.models import User, UserQuota
            from sqlalchemy import select
            from sqlalchemy.orm import selectinload
            
            # Get all users with their quotas
            stmt = select(User).options(selectinload(User.quotas)).where(User.gmt_deleted.is_(None))
            result = await session.execute(stmt)
            users = result.scalars().all()
            
            result_list = []
            for user in users:
                quota_dict = {}
                for quota in user.quotas:
                    quota_dict[quota.key] = {
                        'quota_limit': quota.quota_limit,
                        'current_usage': quota.current_usage,
                        'remaining': max(0, quota.quota_limit - quota.current_usage)
                    }
                
                result_list.append({
                    'user_id': user.id,
                    'username': user.username,
                    'email': user.email,
                    'role': user.role,
                    'quotas': quota_dict
                })
            
            return result_list
        
        return await self.db_ops._execute_query(_query)

    async def update_user_quota(self, user_id: str, quota_type: str, new_limit: int) -> bool:
        """Update quota limit for a user."""
        async def _operation(session):
            from aperag.db.models import UserQuota
            from sqlalchemy import select
            from aperag.utils.utils import utc_now
            
            stmt = select(UserQuota).where(
                UserQuota.user == user_id,
                UserQuota.key == quota_type
            )
            result = await session.execute(stmt)
            quota = result.scalars().first()
            
            if not quota:
                # Create new quota if it doesn't exist
                quota = UserQuota(
                    user=user_id,
                    key=quota_type,
                    quota_limit=new_limit,
                    current_usage=0,
                    gmt_created=utc_now(),
                    gmt_updated=utc_now()
                )
                session.add(quota)
            else:
                quota.quota_limit = new_limit
                quota.gmt_updated = utc_now()
            
            await session.flush()
            return True
        
        return await self.db_ops.execute_with_transaction(_operation)

    async def recalculate_user_usage(self, user_id: str) -> Dict[str, int]:
        """Recalculate actual usage for all quotas of a user."""
        async def _operation(session):
            from aperag.db.models import Collection, Document, Bot, UserQuota
            from sqlalchemy import select, func
            from aperag.utils.utils import utc_now
            
            # Calculate actual usage
            usage_data = {}
            
            # Collection count
            stmt = select(func.count()).select_from(Collection).where(
                Collection.user == user_id,
                Collection.status != 'DELETED'
            )
            collection_count = await session.scalar(stmt)
            usage_data['max_collection_count'] = collection_count
            
            # Total document count across all collections
            stmt = select(func.count(Document.id)).select_from(
                Document.__table__.join(Collection.__table__, Document.collection_id == Collection.id)
            ).where(
                Collection.user == user_id,
                Document.status != 'DELETED',
                Collection.status != 'DELETED'
            )
            total_document_count = await session.scalar(stmt)
            usage_data['max_document_count'] = total_document_count
            
            # Bot count
            stmt = select(func.count()).select_from(Bot).where(
                Bot.user == user_id,
                Bot.gmt_deleted.is_(None)
            )
            bot_count = await session.scalar(stmt)
            usage_data['max_bot_count'] = bot_count
            
            # Update quotas with recalculated usage
            for quota_type, actual_usage in usage_data.items():
                stmt = select(UserQuota).where(
                    UserQuota.user == user_id,
                    UserQuota.key == quota_type
                )
                result = await session.execute(stmt)
                quota = result.scalars().first()
                
                if quota:
                    quota.current_usage = actual_usage
                    quota.gmt_updated = utc_now()
            
            await session.flush()
            return usage_data
        
        return await self.db_ops.execute_with_transaction(_operation)

    async def check_and_consume_quota(self, user_id: str, quota_type: str, amount: int = 1) -> None:
        """
        Check quota availability and consume it atomically.
        Raises QuotaExceededException if quota would be exceeded.
        This should be called within the same transaction as the resource creation.
        """
        async def _operation(session):
            from aperag.db.models import UserQuota
            from sqlalchemy import select
            from aperag.utils.utils import utc_now
            
            # Use SELECT FOR UPDATE to prevent race conditions
            stmt = select(UserQuota).where(
                UserQuota.user == user_id,
                UserQuota.key == quota_type
            ).with_for_update()
            
            result = await session.execute(stmt)
            quota = result.scalars().first()
            
            if not quota:
                raise QuotaExceededException(f"Quota {quota_type} not found for user {user_id}")
            
            # Check if consuming this amount would exceed the limit
            if quota.current_usage + amount > quota.quota_limit:
                raise QuotaExceededException(
                    f"Quota exceeded: {quota_type} limit is {quota.quota_limit}, "
                    f"current usage is {quota.current_usage}, requested amount is {amount}"
                )
            
            # Update usage
            quota.current_usage += amount
            quota.gmt_updated = utc_now()
            
            await session.flush()
        
        return await self.db_ops.execute_with_transaction(_operation)

    async def release_quota(self, user_id: str, quota_type: str, amount: int = 1) -> None:
        """
        Release quota (decrease usage).
        This should be called within the same transaction as the resource deletion.
        """
        async def _operation(session):
            from aperag.db.models import UserQuota
            from sqlalchemy import select
            from aperag.utils.utils import utc_now
            
            stmt = select(UserQuota).where(
                UserQuota.user == user_id,
                UserQuota.key == quota_type
            ).with_for_update()
            
            result = await session.execute(stmt)
            quota = result.scalars().first()
            
            if quota:
                # Ensure we don't go below 0
                quota.current_usage = max(0, quota.current_usage - amount)
                quota.gmt_updated = utc_now()
                await session.flush()
        
        return await self.db_ops.execute_with_transaction(_operation)

    async def initialize_user_quotas(self, user_id: str) -> None:
        """Initialize default quotas for a new user."""
        async def _operation(session):
            from aperag.db.models import UserQuota
            from sqlalchemy import select
            from aperag.utils.utils import utc_now
            
            # Default quota limits (these could be configurable)
            default_quotas = {
                "max_collection_count": 10,
                "max_document_count": 1000,
                "max_document_count_per_collection": 100,
                "max_bot_count": 5,
            }
            
            for quota_type, limit in default_quotas.items():
                # Check if quota already exists
                stmt = select(UserQuota).where(
                    UserQuota.user == user_id,
                    UserQuota.key == quota_type
                )
                result = await session.execute(stmt)
                existing_quota = result.scalars().first()
                
                if not existing_quota:
                    quota = UserQuota(
                        user=user_id,
                        key=quota_type,
                        quota_limit=limit,
                        current_usage=0,
                        gmt_created=utc_now(),
                        gmt_updated=utc_now()
                    )
                    session.add(quota)
            
            await session.flush()
        
        return await self.db_ops.execute_with_transaction(_operation)


# Create a global service instance
quota_service = QuotaService()
