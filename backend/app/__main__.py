"""python -m app —— 启动入口（绑定 127.0.0.1，不对外暴露，M6 SPEC §4.2）。"""
import uvicorn

from .main import create_app


def run() -> None:
    uvicorn.run(create_app(), host="127.0.0.1", port=8000)


if __name__ == "__main__":
    run()
