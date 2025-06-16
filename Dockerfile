# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV APP_HOME=/app
ENV PORT=3000
# This default can be overridden at runtime by docker -e PORT=...

WORKDIR $APP_HOME

# Install uv
# Using pip to install uv for simplicity and to ensure it's in PATH
RUN pip install --no-cache-dir uv

# Copy dependency files
COPY requirements.txt .
# .env.example is informational, actual .env should be provided at runtime or via docker secrets
COPY .env.example .

# Install dependencies using uv
# Using --system to install in the system Python, common for containers
# Ensure the user running the app has permissions if not running as root
RUN uv pip install --no-cache-dir -r requirements.txt --system

# Copy the application code
COPY src/ ./src/

# Create a .env file from .env.example or an empty one
# This allows the application to start if it expects a .env file,
# but it should be populated by runtime configurations or volume mounts.
# The application's load_dotenv() will then pick up runtime-provided variables.
RUN if [ ! -f .env ]; then touch .env; fi

# Expose the port the app runs on
EXPOSE $PORT

# Command to run the application
# Uvicorn will look for src.app:asgi_app
# The host 0.0.0.0 makes it accessible from outside the container
# $PORT will be substituted by the ENV PORT value
CMD ["uvicorn", "src.app:asgi_app", "--host", "0.0.0.0", "--port", "$PORT"]
