import os
from dotenv import load_dotenv
import monday_code


load_dotenv()
_cached_headers = None

def get_headers():
    global _cached_headers
    if _cached_headers is not None:
        return _cached_headers

    print("before try")
    api_key = get_api_key_from_secrets()

    if not api_key:
        api_key = os.getenv("MONDAY_API_KEY")

    _cached_headers = {
        "Authorization": api_key,
        "Content-Type": "application/json",
        "API-Version": "2024-10"
    }
    return _cached_headers



def get_api_key_from_secrets():
    print("🔐 Trying to fetch MONDAY_API_KEY from Monday secrets...")

    try:
        config = monday_code.Configuration()
        with monday_code.ApiClient(config) as api_client:
            secrets_api = monday_code.SecretsApi(api_client)
            print("📡 Calling secrets_api.get_secret(...)")
            secret = secrets_api.get_secret("MONDAY_API_KEY")

            if secret:
                print("✅ Secret fetched successfully (string), returning it.")
                return secret
            else:
                print("⚠️ get_secret returned None or empty.")

    except Exception as e:
        print(f"❌ Exception while fetching secret: {e}")

    print("⛔ Failed to get MONDAY_API_KEY from secrets, returning None.")
    return None