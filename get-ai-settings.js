// Global helper function to get AI settings from server
window.getAISettings = async function() {
  try {
    const response = await fetch(`${window.location.origin}/api/settings`);
    if (response.ok) {
      const settings = await response.json();
      return {
        apiKey: settings.ai_api_key || '',
        baseUrl: settings.ai_base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        modelName: settings.ai_model_name || 'qwen-vl-plus-latest'
      };
    }
  } catch (error) {
    console.error('Failed to get AI settings:', error);
  }
  return {
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelName: 'qwen-vl-plus-latest'
  };
};
