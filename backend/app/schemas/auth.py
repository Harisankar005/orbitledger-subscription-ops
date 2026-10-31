from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserBase(BaseModel):
    email: str = Field(..., pattern=EMAIL_PATTERN, max_length=255)
    full_name: str = Field(..., min_length=1, max_length=255)


class RegisterRequest(UserBase):
    password: str = Field(..., min_length=9, max_length=128)
    company: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=50)
    billing_address: Optional[str] = None
    tax_id: Optional[str] = Field(None, max_length=50)


class LoginRequest(BaseModel):
    email: str = Field(..., pattern=EMAIL_PATTERN, max_length=255)
    password: str = Field(..., min_length=1)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., pattern=EMAIL_PATTERN, max_length=255)


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=10)
    new_password: str = Field(..., min_length=9, max_length=128)


class StaffCreateRequest(UserBase):
    password: str = Field(..., min_length=9, max_length=128)


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=255)
    is_active: Optional[bool] = None
    role: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    email: str
    role: str
    full_name: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomerResponse(BaseModel):
    id: int
    user_id: Optional[int]
    name: str
    email: str
    phone: Optional[str]
    company: Optional[str]
    billing_address: Optional[str]
    tax_id: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
