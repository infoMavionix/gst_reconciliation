from pydantic import BaseModel, Field, ConfigDict

class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    legal_name: str | None = Field(default=None, max_length=250)
    gstin: str | None = Field(default=None, min_length=15, max_length=15)
    pan: str | None = Field(default=None, min_length=10, max_length=10)
    business_email: str | None = None

class OrganizationResponse(BaseModel):
    id: int
    name: str
    legal_name: str | None
    gstin: str | None
    pan: str | None
    business_email: str | None
    model_config = ConfigDict(from_attributes=True)
