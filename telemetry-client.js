class TelemetryClient {
    constructor(baseUrl = 'http://localhost:8001') {
        this.baseUrl = baseUrl;
        this.timeoutMs = 2000;
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
