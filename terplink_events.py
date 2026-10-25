import requests
import pandas as pd
from datetime import datetime

def fetch_terplink_events(limit=50, start_date=str(datetime.now().isoformat(timespec='seconds'))):
    """
    Fetches public events directly from the TerpLink API endpoint.
    """
    # TerpLink's underlying Campus Labs API endpoint
    url = "https://terplink.umd.edu/api/discovery/event/search"
    
    # Query parameters used by the site's search UI
    params = {
        "endsAfter": start_date,      # Format: YYYY-MM-DDTHH:mm:ss (Leave empty or set current ISO date)
        "take": limit,         # Number of events to fetch
        "skip": 0,            # Offset for pagination
    }

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*"
    }

    try:
        response = requests.get(url, params=params, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        events = data.get("value", [])
        print(f"Successfully retrieved {len(events)} events.")
        
        parsed_events = []
        for event in events:
            parsed_events.append({
                "Event ID": event.get("id"),
                "Title": event.get("title"),
                "Organization": event.get("organizationName"),
                "Start Time": event.get("startsOn"),
                "End Time": event.get("endsOn"),
                "Location": event.get("location"),
                "Category / Themes": ", ".join([theme for theme in event.get("themeNames", [])]),
                "URL": f"https://terplink.umd.edu/event/{event.get('id')}"
            })
            
        return parsed_events

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from API: {e}")
        return []

# Run the scraper
events_data = fetch_terplink_events(limit=50)

# Save results to CSV and JSON
if events_data:
    df = pd.DataFrame(events_data)
    df.to_csv("terplink_events.csv", index=False)
    df.to_json("terplink_events.json", orient='records')
    print("Saved events to terplink_events.csv")
    print(df.head())