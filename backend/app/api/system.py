"""系统端点：/health、/config（M6 SPEC §2.8）。"""
from __future__ import annotations

from fastapi import APIRouter

from ..config import settings

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    return {
        "status": "ok",
        "models_configured": bool(settings.deepseek_api_key),
        "data_dir": settings.data_dir,
    }


@router.get("/config")
def config_summary():
    """前端可读的配置摘要——永不暴露 key（架构 §3.4 红线）。"""
    return {
        "llm": {
            "writer": settings.llm_writer_model,
            "reviewer": settings.llm_reviewer_model,
            "distiller": settings.llm_distiller_model,
            "base_url": settings.deepseek_base_url,
            "key_configured": bool(settings.deepseek_api_key),
        },
        "budgets": {"context_budget": settings.context_budget,
                    "session_token_budget": settings.session_token_budget},
        "pipeline": {"prior_full_k": settings.prior_full_k,
                     "max_rounds": settings.max_rounds},
    }
