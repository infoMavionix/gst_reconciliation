from pydantic import BaseModel, EmailStr, Field, ConfigDict

class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    organization_name: str = Field(min_length=2, max_length=200)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class OrganizationOut(BaseModel):
    id: int
    name: str
    gstin: str | None = None
    role: str
    model_config = ConfigDict(from_attributes=True)

class UserOut(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    memberships: list[OrganizationOut]

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict
