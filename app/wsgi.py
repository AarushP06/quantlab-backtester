"""WSGI entry point for Gunicorn."""

from . import create_app

app = create_app()
