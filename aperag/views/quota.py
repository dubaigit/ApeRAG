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
from typing import Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPBearer

from aperag.auth.authentication import get_current_user
from aperag.db.models import Role, User
from aperag.schema.view_models import (
    QuotaInfo,
    QuotaUpdateRequest,
    QuotaUpdateResponse,
    UserQuotaInfo,
    UserQuotaList,
)
from aperag.service.quota_service import quota_service

logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer()


def _convert_quota_dict_to_list(quota_dict: Dict[str, Dict[str, int]]) -> List[QuotaInfo]:
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
    user_id: Optional[str] = Query(None, description="User ID to get quotas for (admin only)"),
    all_users: bool = Query(False, description="Get quotas for all users (admin only)"),
    current_user: User = Depends(get_current_user)
):
    """
    Get quota information for the current user or all users (admin only)
    """
    try:
        if all_users:
            # Admin only - get all users' quotas
            if current_user.role != Role.ADMIN:
                raise HTTPException(status_code=403, detail="Admin access required")
            
            all_user_quotas = await quota_service.list_all_user_quotas(current_user.id)
            
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
        
        return UserQuotaInfo(
            user_id=target_user_id,
            username=current_user.username if target_user_id == current_user.id else target_user_id,
            email=current_user.email if target_user_id == current_user.id else None,
            role=current_user.role if target_user_id == current_user.id else "unknown",
            quotas=quota_list
        )
        
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting quotas: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/quotas/{user_id}", response_model=QuotaUpdateResponse)
async def update_quota(
    user_id: str,
    request: QuotaUpdateRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Update quota limit for a specific user (admin only)
    """
    try:
        # Only admin users can update quotas
        if current_user.role != Role.ADMIN:
            raise HTTPException(status_code=403, detail="Admin access required")
        
        # Get current quota to return old limit
        user_quotas = await quota_service.get_user_quotas(user_id)
        old_limit = user_quotas.get(request.quota_type, {}).get('quota_limit', 0)
        
        # Update the quota
        success = await quota_service.update_user_quota(
            admin_user_id=current_user.id,
            target_user_id=user_id,
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
        
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating quota: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/quotas/{user_id}/recalculate")
async def recalculate_quota_usage(
    user_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Recalculate and update current usage for all quota types for a user (admin only)
    """
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
