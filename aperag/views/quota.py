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

import logging
from typing import List, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPBearer

from aperag.views.auth import current_user
from aperag.db.models import Role, User
from aperag.schema.view_models import (
    QuotaInfo,
    QuotaUpdateRequest,
    QuotaUpdateResponse,
    UserQuotaInfo,
    UserQuotaList,
    SystemDefaultQuotas,
    SystemDefaultQuotasResponse,
    SystemDefaultQuotasUpdateRequest,
    SystemDefaultQuotasUpdateResponse,
)
from aperag.service.quota_service import quota_service

logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer()


def _convert_quota_dict_to_list(quota_dict: dict) -> List[QuotaInfo]:
    """Convert quota dictionary to list of QuotaInfo objects"""
    return [
        QuotaInfo(
            quota_type=quota_type,
            quota_limit=info['quota_limit'],
            current_usage=info['current_usage'],
            remaining=info['remaining']
        )
        for quota_type, info in quota_dict.items()
    ]


@router.get("/quotas", response_model=Union[UserQuotaInfo, UserQuotaList])
async def get_quotas(
    user_id: str = Query(None, description="User ID to get quotas for (admin only)"),
    all_users: bool = Query(False, description="Get quotas for all users (admin only)"),
    current_user: User = Depends(current_user)
):
    """Get quota information for the current user or all users (admin only)"""
    try:
        if all_users:
            # Admin only - get all users' quotas
            if current_user.role != Role.ADMIN:
                raise HTTPException(status_code=403, detail="Admin access required")
            
            all_user_quotas = await quota_service.get_all_users_quotas()
            
            items = []
            for user_quota in all_user_quotas:
                quota_list = _convert_quota_dict_to_list(user_quota['quotas'])
                items.append(UserQuotaInfo(
                    user_id=user_quota['user_id'],
                    username=user_quota['username'],
                    email=user_quota['email'],
                    role=user_quota['role'],
                    quotas=quota_list
                ))
            
            return UserQuotaList(items=items)
        
        elif user_id:
            # Admin only - get specific user's quotas
            if current_user.role != Role.ADMIN:
                raise HTTPException(status_code=403, detail="Admin access required")
            
            target_user_id = user_id
        else:
            # Get current user's quotas
            target_user_id = current_user.id
        
        # Get quotas for the target user
        user_quotas = await quota_service.get_user_quotas(target_user_id)
        quota_list = _convert_quota_dict_to_list(user_quotas)
        
        # For single user response, we need to get user info
        if target_user_id == current_user.id:
            username = current_user.username
            email = current_user.email
            role = current_user.role
        else:
            # For admin getting other user's quota, we need to fetch user info
            from aperag.db.repositories.user import AsyncUserRepositoryMixin
            from aperag.db.ops import async_db_ops
            
            class UserRepo(AsyncUserRepositoryMixin):
                def __init__(self):
                    self.db_ops = async_db_ops
                    
                async def _execute_query(self, query_func):
                    return await self.db_ops._execute_query(query_func)
                    
                async def execute_with_transaction(self, operation_func):
                    return await self.db_ops.execute_with_transaction(operation_func)
            
            user_repo = UserRepo()
            target_user = await user_repo.query_user_by_id(target_user_id)
            if not target_user:
                raise HTTPException(status_code=404, detail="User not found")
            
            username = target_user.username
            email = target_user.email
            role = target_user.role
        
        return UserQuotaInfo(
            user_id=target_user_id,
            username=username,
            email=email,
            role=role,
            quotas=quota_list
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting quotas: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/quotas/{user_id}", response_model=QuotaUpdateResponse)
async def update_quota(
    user_id: str,
    request: QuotaUpdateRequest,
    current_user: User = Depends(current_user)
):
    """Update quota limit for a specific user (admin only)"""
    try:
        # Only admin users can update quotas
        if current_user.role != Role.ADMIN:
            raise HTTPException(status_code=403, detail="Admin access required")
        
        # Get current quota to return old limit
        user_quotas = await quota_service.get_user_quotas(user_id)
        old_limit = user_quotas.get(request.quota_type, {}).get('quota_limit', 0)
        
        # Update the quota
        success = await quota_service.update_user_quota(
            user_id=user_id,
            quota_type=request.quota_type,
            new_limit=request.new_limit
        )
        
        if not success:
            raise HTTPException(status_code=400, detail="Failed to update quota")
        
        return QuotaUpdateResponse(
            success=True,
            message="Quota updated successfully",
            user_id=user_id,
            quota_type=request.quota_type,
            old_limit=old_limit,
            new_limit=request.new_limit
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating quota: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/quotas/{user_id}/recalculate")
async def recalculate_quota_usage(
    user_id: str,
    current_user: User = Depends(current_user)
):
    """Recalculate and update current usage for all quota types for a user (admin only)"""
    try:
        # Only admin users can recalculate quotas
        if current_user.role != Role.ADMIN:
            raise HTTPException(status_code=403, detail="Admin access required")
        
        # Recalculate usage
        updated_usage = await quota_service.recalculate_user_usage(user_id)
        
        return {
            "success": True,
            "message": "Quota usage recalculated successfully",
            "updated_usage": updated_usage
        }
        
    except Exception as e:
        logger.error(f"Error recalculating quota usage: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/system/default-quotas", response_model=SystemDefaultQuotasResponse)
async def get_system_default_quotas(
    current_user: User = Depends(current_user)
):
    """Get system default quota configuration (admin only)"""
    try:
        # Only admin users can view system default quotas
        if current_user.role != Role.ADMIN:
            raise HTTPException(status_code=403, detail="Admin access required")
        
        # Get system default quotas
        default_quotas = await quota_service.get_system_default_quotas()
        
        return SystemDefaultQuotasResponse(
            quotas=SystemDefaultQuotas(**default_quotas)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting system default quotas: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/system/default-quotas", response_model=SystemDefaultQuotasUpdateResponse)
async def update_system_default_quotas(
    request: SystemDefaultQuotasUpdateRequest,
    current_user: User = Depends(current_user)
):
    """Update system default quota configuration (admin only)"""
    try:
        # Only admin users can update system default quotas
        if current_user.role != Role.ADMIN:
            raise HTTPException(status_code=403, detail="Admin access required")
        
        # Convert Pydantic model to dict
        quotas_dict = request.quotas.dict()
        
        # Update system default quotas
        success = await quota_service.update_system_default_quotas(quotas_dict)
        
        if not success:
            raise HTTPException(status_code=400, detail="Failed to update system default quotas")
        
        return SystemDefaultQuotasUpdateResponse(
            success=True,
            message="System default quotas updated successfully",
            quotas=request.quotas
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating system default quotas: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
