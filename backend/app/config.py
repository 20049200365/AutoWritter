"""配置层：读取仓库根目录 .env（见 M6 SPEC §5，key 永不入库/入文档）。"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(REPO_ROOT / ".env"), extra="ignore")

    # ---- LLM（三角色，M3 §7）----
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    llm_writer_model: str = "deepseek-v4-flash"
    llm_reviewer_model: str = "deepseek-v4-flash"
    llm_distiller_model: str = "deepseek-v4-flash"

    # ---- 预算（软上限，架构 §5.3）----
    context_budget: int = 128_000
    session_token_budget: int = 8_000

    # ---- 护栏（M3 §7）----
    max_tool_rounds: int = 8
    tool_timeout_s: int = 60
    max_rounds: int = 5

    # ---- 流水线 ----
    prior_full_k: int = 3

    # ---- 存储（M6 §5：~/.novelstudio，可整体拷走）----
    data_dir: str = str(Path.home() / ".novelstudio")

    @property
    def db_path(self) -> Path:
        return Path(self.data_dir) / "novel.db"

    @property
    def skills_dir(self) -> Path:
        return Path(self.data_dir) / "skills"

    def ensure_dirs(self) -> None:
        Path(self.data_dir).mkdir(parents=True, exist_ok=True)
        self.skills_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
