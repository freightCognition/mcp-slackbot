import os
import httpx
import asyncio
from dotenv import load_dotenv, set_key
from slack_bolt.async_app import AsyncApp # Use AsyncApp for async features
from slack_bolt.adapter.starlette.async_handler import AsyncSlackRequestHandler
from starlette.applications import Starlette
from starlette.routing import Route, Mount
from starlette.responses import JSONResponse
import logging
import uvicorn # For __main__ block

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
# General logger for this module, used for startup messages, .env loading issues etc.
module_logger = logging.getLogger(__name__)

# --- Environment Variable Loading ---
# Determine the .env file path. Assumes .env is in the project root.
# If app.py is in src/, CWD is usually project root when running with uvicorn.
env_file_path = os.path.join(os.getcwd(), ".env")
if not os.path.exists(env_file_path):
    # Fallback if CWD is not project root (e.g. running script directly from src/)
    alt_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    if os.path.exists(alt_env_path):
        env_file_path = os.path.normpath(alt_env_path)
    else:
        module_logger.warning(f".env file not found at {env_file_path} or {alt_env_path}. Proceeding without it if env vars are set externally.")

# Load .env, override ensures that if a var is already in os.environ, it's updated from .env
# If .env doesn't exist, load_dotenv doesn't fail, just returns False.
load_dotenv(dotenv_path=env_file_path, override=True)
module_logger.info(f"Attempted to load .env file from: {env_file_path}")


BEARER_TOKEN = os.environ.get("BEARER_TOKEN")
REFRESH_TOKEN = os.environ.get("REFRESH_TOKEN")
TOKEN_ENDPOINT_URL = os.environ.get("TOKEN_ENDPOINT_URL")
SLACK_SIGNING_SECRET = os.environ.get("SLACK_SIGNING_SECRET")
SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL")

required_vars = {
    "BEARER_TOKEN": BEARER_TOKEN, "REFRESH_TOKEN": REFRESH_TOKEN,
    "TOKEN_ENDPOINT_URL": TOKEN_ENDPOINT_URL, "SLACK_SIGNING_SECRET": SLACK_SIGNING_SECRET,
    "SLACK_WEBHOOK_URL": SLACK_WEBHOOK_URL,
}
missing_vars = [var for var, value in required_vars.items() if not value]
if missing_vars:
    module_logger.error(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
    exit(1)
module_logger.info("Environment variables loaded and validated.")


# Initialize Bolt AsyncApp
bolt_app = AsyncApp(
    signing_secret=SLACK_SIGNING_SECRET,
    # token=os.environ.get("SLACK_BOT_TOKEN") # Add if bot token needed for other Slack features
)
# This handler will be used by Starlette to forward requests to Bolt
slack_handler = AsyncSlackRequestHandler(bolt_app)

# --- Helper Functions ---
def get_risk_level_emoji(points: int) -> str:
    if 0 <= points <= 124: return '🟢'
    elif 125 <= points <= 249: return '🟡'
    elif 250 <= points <= 999: return '🟠'
    else: return '🔴'

def get_risk_level(points: int) -> str:
    if 0 <= points <= 124: return 'Low'
    elif 125 <= points <= 249: return 'Medium'
    elif 250 <= points <= 999: return 'Review Required'
    else: return 'Fail'

def format_infractions(infractions: list) -> str:
    if not infractions: return "No infractions found."
    return "\n".join([
        f"- {infraction.get('RuleText', 'N/A')}: {infraction.get('RuleOutput', 'N/A')} ({infraction.get('Points', 'N/A')} points)"
        for infraction in infractions
    ])

# --- Token Management Functions ---
async def refresh_access_token(passed_logger: logging.Logger) -> bool:
    global BEARER_TOKEN, REFRESH_TOKEN

    passed_logger.info("Attempting to refresh access token...")
    if not REFRESH_TOKEN or not TOKEN_ENDPOINT_URL:
        passed_logger.error("REFRESH_TOKEN or TOKEN_ENDPOINT_URL is not set. Cannot refresh.")
        return False

    data = {'grant_type': 'refresh_token', 'refresh_token': REFRESH_TOKEN}
    headers = {'Content-Type': 'application/x-www-form-urlencoded'}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(TOKEN_ENDPOINT_URL, data=data, headers=headers)
        response.raise_for_status()
        token_data = response.json()
        new_access_token = token_data.get('access_token')
        new_refresh_token = token_data.get('refresh_token')

        if not new_access_token:
            passed_logger.error("New access token not found in refresh response.")
            return False

        passed_logger.info("Access token refreshed successfully.")
        BEARER_TOKEN = new_access_token
        os.environ["BEARER_TOKEN"] = new_access_token # Update current process's env
        updated_env_values = {"BEARER_TOKEN": new_access_token}

        if new_refresh_token:
            passed_logger.info("New refresh token received.")
            REFRESH_TOKEN = new_refresh_token
            os.environ["REFRESH_TOKEN"] = new_refresh_token # Update current process's env
            updated_env_values["REFRESH_TOKEN"] = new_refresh_token
        else:
            passed_logger.warning("New refresh token was not provided. Old refresh token will be reused.")

        # Persist to .env file
        # Ensure the env_file_path is absolute for set_key
        abs_env_file_path = os.path.abspath(env_file_path)
        if not os.path.exists(os.path.dirname(abs_env_file_path)):
             passed_logger.error(f"Directory for .env file does not exist: {os.path.dirname(abs_env_file_path)}")
             return False # Cannot create .env file if directory is missing

        if not os.path.exists(abs_env_file_path):
             passed_logger.warning(f".env file not found at {abs_env_file_path} for updating tokens. Creating it.")
             try:
                 with open(abs_env_file_path, 'w') as f: # Create empty file
                     pass
             except IOError as e:
                 passed_logger.error(f"Could not create .env file at {abs_env_file_path}: {e}", exc_info=True)
                 return False # If we can't create it, we can't write to it.

        try:
            for key, value in updated_env_values.items():
                set_key(abs_env_file_path, key, value, quote_mode="never")
            passed_logger.info(f".env file at {abs_env_file_path} updated with new tokens.")
        except Exception as e:
            passed_logger.error(f"Error writing to .env file at {abs_env_file_path}: {e}", exc_info=True)
            # Decide if this is critical; for now, in-memory update is done.
            # Depending on deployment, file write might be essential or impossible (e.g. read-only filesystem)

        return True
    except httpx.HTTPStatusError as e:
        passed_logger.error(f"Error refreshing access token: {e.response.status_code} - {e.response.text}", exc_info=True)
        if e.response.status_code == 400 or e.response.status_code == 401 : # Common for invalid refresh token
            passed_logger.error("Refresh token might be invalid or expired. Manual intervention may be required.")
        return False
    except httpx.RequestError as e:
        passed_logger.error(f"Network error refreshing access token: {e}", exc_info=True)
        return False
    except Exception as e:
        passed_logger.error(f"An unexpected error occurred during token refresh: {e}", exc_info=True)
        return False

# --- Bolt Command Handler ---
# Bolt provides its own logger to handlers, named 'logger' by default in the parameters.
@bolt_app.command("/mcp-preview")
async def mcp_preview_command(ack, body, client, logger: logging.Logger, respond):
    await ack()

    mc_number = body.get('text', '').strip()
    if not mc_number:
        await respond("Please provide a valid MC number.")
        return

    logger.info(f"Received /mcp-preview command for MC number: {mc_number}")

    api_url = "https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier"
    params = {"docketNumber": mc_number}

    for attempt in range(2):
        current_bearer_token = BEARER_TOKEN
        headers = {"Authorization": f"Bearer {current_bearer_token}", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=10.0) as http_client:
                api_response = await http_client.post(api_url, headers=headers, params=params)
            api_response.raise_for_status()
            response_data = api_response.json()

            if not response_data:
                logger.info(f"No data found for MC number: {mc_number} on attempt {attempt + 1}")
                await respond("No data found for the provided MC number.")
                return
            data = response_data[0]
            logger.info(f"Data received for MC number: {mc_number} on attempt {attempt + 1}")

            # --- Block Kit Construction ---
            blocks = [
                {"type": "header", "text": {"type": "plain_text", "text": "MyCarrierPortal Risk Assessment", "emoji": True}},
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*{data.get('CompanyName', 'N/A')}*\nDOT: {data.get('DotNumber', 'N/A')} / MC: {data.get('DocketNumber', 'N/A')}"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*Overall assessment:* {get_risk_level_emoji(data.get('RiskAssessmentDetails', {}).get('TotalPoints', 0))} {get_risk_level(data.get('RiskAssessmentDetails', {}).get('TotalPoints', 0))}"}},
                {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Total Points: {data.get('RiskAssessmentDetails', {}).get('TotalPoints', 'N/A')}"}]},
                {"type": "divider"}
            ]
            categories = ['Authority', 'Insurance', 'Operation', 'Safety', 'Other']
            risk_details = data.get('RiskAssessmentDetails', {})
            for category in categories:
                category_data = risk_details.get(category)
                if category_data:
                    blocks.extend([
                        {"type": "section", "text": {"type": "mrkdwn", "text": f"*{category}:* {get_risk_level_emoji(category_data.get('TotalPoints',0))} {get_risk_level(category_data.get('TotalPoints',0))}"}},
                        {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Risk Level: {get_risk_level(category_data.get('TotalPoints',0))} | Points: {category_data.get('TotalPoints',0)}\nInfractions:\n{format_infractions(category_data.get('Infractions', []))}"}]}
                    ])
            mcp_infractions = []
            mcp_total_points = 0
            if data.get('IsBlocked'):
                mcp_total_points += 1000
                mcp_infractions.append({'Points': 1000, 'RuleText': 'MyCarrierProtect: Blocked', 'RuleOutput': 'Carrier blocked by 3 or more companies'})
            if data.get('FreightValidateStatus') == 'Review Recommended':
                mcp_total_points += 1000
                mcp_infractions.append({'Points': 1000, 'RuleText': 'FreightValidate Status', 'RuleOutput': 'Carrier has a FreightValidate Review Recommended status'})
            if mcp_total_points > 0:
                mcp_overall_rating = get_risk_level(mcp_total_points)
                blocks.extend([
                    {"type": "section", "text": {"type": "mrkdwn", "text": f"*MyCarrierProtect:* {get_risk_level_emoji(mcp_total_points)} {mcp_overall_rating}"}},
                    {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Risk Level: {mcp_overall_rating} | Points: {mcp_total_points}\nInfractions:\n{format_infractions(mcp_infractions)}"}]},
                    {"type": "divider"}
                ])
            # --- End Block Kit Construction ---
            await respond(blocks=blocks, response_type='in_channel')
            logger.info(f"Successfully sent response for MC: {mc_number}")
            return

        except httpx.HTTPStatusError as e:
            logger.warning(f"API call attempt {attempt + 1} for MC {mc_number} failed: {e.response.status_code} - {e.response.text}", exc_info=True)
            if e.response.status_code == 401 and attempt == 0:
                logger.info("Access token expired or invalid. Attempting refresh...")
                refreshed = await refresh_access_token(logger) # Pass Bolt's logger
                if refreshed:
                    logger.info("Token refreshed. Retrying API call...")
                    continue
                else:
                    logger.error("Failed to refresh token. Aborting.")
                    await respond("Error: Could not refresh authentication. Please check logs or contact admin.")
                    return
            await respond(f"Error: API request failed with status {e.response.status_code} after {attempt + 1} attempt(s). Details: {e.response.text}")
            return
        except httpx.RequestError as e:
            logger.error(f"API call failed (network error) for MC {mc_number} on attempt {attempt + 1}: {e}", exc_info=True)
            await respond("Error: Could not connect to the data service. Please try again later.")
            return
        except Exception as e:
            logger.error(f"An unexpected error occurred for MC {mc_number} on attempt {attempt + 1}: {e}", exc_info=True)
            await respond("An unexpected error occurred. Please check logs or contact an administrator.")
            return

# --- Health Check Endpoint ---
async def health_check(request):
    # This logger will be the 'module_logger' if accessed here directly
    module_logger.info("Health check endpoint was accessed.")
    return JSONResponse({"status": "healthy", "message": "Application is running"})

# --- Starlette App Setup ---
# Define routes for Starlette. The Bolt app handler will manage all /slack/* routes.
routes = [
    Route("/health", endpoint=health_check, methods=["GET"]),
    # Mount the Slack app handler to /slack/events. This is a common default.
    # Ensure your Slack app's Request URL for slash commands/events points here.
    Mount("/slack/events", slack_handler),
    # If you use OAuth for distribution, you might need these:
    # Mount("/slack/install", slack_handler),
    # Mount("/slack/oauth_redirect", slack_handler),
]

# The main ASGI app instance for Uvicorn to run
asgi_app = Starlette(routes=routes, debug=True) # debug=True for more verbose errors during dev

# --- Main execution block for local development ---
if __name__ == "__main__":
    module_logger.info("Starting Uvicorn for local development with Starlette wrapper...")
    server_port = int(os.environ.get("PORT", 3000))
    # This runs the Starlette app (asgi_app) using uvicorn.
    # reload=True is useful for development to automatically pick up code changes.
    uvicorn.run(
        "__main__:asgi_app", # Points to the asgi_app instance in the current file
        host="0.0.0.0",
        port=server_port,
        reload=True, # Enable auto-reload for development
        log_level="info" # Set uvicorn's log level
    )
