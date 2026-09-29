from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    n8n_webhook_url: str = ""
    sentry_dsn: str = ""
    environment: str = "development"
    api_key: str
    gemini_api_key: str = ""
    gemini_model: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
