// Load AI settings from server on page load
async function loadAISettings() {
    try {
        const response = await fetch(`${window.location.origin}/api/settings`);
        if (response.ok) {
            const settings = await response.json();
            if (settings.ai_api_key) {
                const input = document.getElementById('ai-api-key');
                if (input) {
                    input.value = settings.ai_api_key;
                    input.dataset.realValue = settings.ai_api_key;
                }
            }
            if (settings.ai_base_url) {
                const baseUrlInput = document.getElementById('ai-base-url');
                if (baseUrlInput) baseUrlInput.value = settings.ai_base_url;
            }
            if (settings.ai_model_name) {
                const modelInput = document.getElementById('ai-model-name');
                if (modelInput) modelInput.value = settings.ai_model_name;
            }
        }
    } catch (error) {
        console.error('Failed to load AI settings:', error);
    }
}

// Call loadAISettings when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAISettings);
} else {
    loadAISettings();
}
