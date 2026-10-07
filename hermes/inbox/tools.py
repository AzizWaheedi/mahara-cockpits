"""Named provider calls. No message-send route, automatic retry, or secret logging."""
import json
import urllib.error
import urllib.request


def provider_json(store, provider, method, url, headers, body=None):
    if provider == 'ghl':
        if method != 'GET' or not url.startswith('https://services.leadconnectorhq.com/conversations/'):
            raise ValueError('Inbox GHL calls must be conversation reads')
    elif provider == 'deepseek':
        if method != 'POST' or url != 'https://api.deepseek.com/chat/completions' or not store.apply:
            raise ValueError('Model calls require an applied drafting run')
    else:
        raise ValueError('Unknown inbox provider')
    resource = 'inbox:' + url.split('?', 1)[0]
    store.health(provider, method, resource, 'intent', None)
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    status = None
    try:
        with urllib.request.urlopen(request, timeout=180 if provider == 'deepseek' else 60) as response:
            status = response.status
            result = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        store.health(provider, method, resource, 'response', error.code)
        raise RuntimeError(f'{provider} returned HTTP {error.code}') from None
    except Exception:
        store.health(provider, method, resource, 'unknown', status)
        raise RuntimeError(f'{provider} outcome is unknown. Check the provider health ledger.') from None
    store.health(provider, method, resource, 'response', status)
    return result
