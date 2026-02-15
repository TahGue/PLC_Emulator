class TelemetryClient {
    constructor(baseUrl = null) {
        this.baseUrl = baseUrl || this.resolveBaseUrl();
        this.timeoutMs = 2000;
    }

    resolveBaseUrl() {
        if (typeof window !== 'undefined' && window.location) {
            return `${window.location.protocol}//${window.location.hostname}:8001`;
        }
        return 'http://localhost:8001';
    }

    async checkHealth() {
        try {
            const response = await this.request('/health', {
                method: 'GET'
            });

            return {
                ok: Boolean(response.ok),
                db: Boolean(response.db)
            };
        } catch (error) {
            return {
                ok: false,
                db: false,
                error: error.message
            };
        }
    }

    async analyze(payload) {
        const response = await this.request('/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        return response;
    }

    connectEventStream(onEvent, onError, sinceId = 0) {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        const url = `${this.baseUrl}/events/stream?since_id=${sinceId}`;
        this.eventSource = new EventSource(url);

        this.eventSource.onmessage = (message) => {
            try {
                const event = JSON.parse(message.data);
                if (onEvent) {
                    onEvent(event);
                }
            } catch (error) {
                console.warn('SSE parse error:', error.message);
            }
        };

        this.eventSource.onerror = () => {
            if (onError) {
                onError();
            }
        };

        return this.eventSource;
    }

    disconnectEventStream() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    async request(path, options) {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                ...options,
                signal: controller.signal
            });

            if (!response.ok) {
                const message = await response.text();
                throw new Error(`HTTP ${response.status}: ${message}`);
            }

            return await response.json();
        } finally {
            clearTimeout(timeoutHandle);
        }
    }
}
