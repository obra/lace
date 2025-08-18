// ABOUTME: Specialized badge component for LLM model names with consistent styling
// ABOUTME: Maps model names like 'claude', 'gpt-4', 'gemini' to appropriate badge variants

import React from 'react';
import { Badge } from '@/components/ui';

interface LLMModelBadgeProps {
  model: string;
  className?: string;
}

const LLMModelBadge = ({ model, className }: LLMModelBadgeProps) => {
  // Map LLM model names to appropriate badge variants
  const getVariantForModel = (modelName: string) => {
    const normalizedModel = modelName.toLowerCase();

    if (normalizedModel.includes('claude')) {
      return 'primary';
    }
    if (normalizedModel.includes('gpt') || normalizedModel.includes('openai')) {
      return 'success';
    }
    if (normalizedModel.includes('gemini') || normalizedModel.includes('google')) {
      return 'info';
    }

    // Default for unknown models
    return 'secondary';
  };

  // Format model name for display
  const formatModelName = (modelName: string) => {
    return modelName.toUpperCase();
  };

  return (
    <Badge variant={getVariantForModel(model)} className={className}>
      {formatModelName(model)}
    </Badge>
  );
};

export default LLMModelBadge;
