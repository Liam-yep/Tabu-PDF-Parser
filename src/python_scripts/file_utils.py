import os

async def download_file(session, file_url, file_name):
    async with session.get(file_url) as response:
        if response.status == 200:
            if not os.path.exists("downloads"):
                os.makedirs("downloads")
            file_path = os.path.join("downloads", file_name)
            with open(file_path, 'wb') as f:
                f.write(await response.read())
            print(f"✅ File downloaded: {file_name}", flush=True)
            return file_path

        else:
            print(f"❌ Failed to download file: {file_name}, Status code: {response.status}", flush=True)
            raise Exception(f"Failed to download file. Status code: {response.status}")
