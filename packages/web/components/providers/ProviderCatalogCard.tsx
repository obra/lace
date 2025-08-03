// ABOUTME: Individual provider card showing models and pricing
// ABOUTME: Uses design system cards, badges, and buttons

import Badge from '@/components/ui/Badge';

interface CatalogModel {
  id: string;
  name: string;
  cost_per_1m_in: number;
  cost_per_1m_out: number;
  cost_per_1m_in_cached?: number;
  cost_per_1m_out_cached?: number;
  context_window: number;
  default_max_tokens: number;
  can_reason?: boolean;
  has_reasoning_effort?: boolean;
  supports_attachments?: boolean;
}

interface CatalogProvider {
  id: string;
  name: string;
  type: string;
  api_key?: string;
  api_endpoint?: string;
  default_large_model_id: string;
  default_small_model_id: string;
  models: CatalogModel[];
}

interface ProviderCatalogCardProps {
  provider: CatalogProvider;
  onAddInstance: () => void;
}

export function ProviderCatalogCard({ provider, onAddInstance }: ProviderCatalogCardProps) {
  const minInputPrice = Math.min(...provider.models.map(m => m.cost_per_1m_in));
  const maxOutputPrice = Math.max(...provider.models.map(m => m.cost_per_1m_out));
  
  const getTypeColor = (type: string): 'primary' | 'success' | 'info' | 'accent' | 'outline' => {
    switch (type.toLowerCase()) {
      case 'anthropic': return 'primary';
      case 'openai': return 'success';
      case 'ollama': return 'info';
      case 'openrouter': return 'accent';
      default: return 'outline';
    }
  };

  const formatPrice = (price: number) => {
    if (price === 0) return 'Free';
    if (price < 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(0)}`;
  };

  const getModelFeatures = () => {
    const features = [];
    const hasReasoning = provider.models.some(m => m.can_reason);
    const hasAttachments = provider.models.some(m => m.supports_attachments);
    const maxContext = Math.max(...provider.models.map(m => m.context_window));
    
    if (hasReasoning) features.push('Reasoning');
    if (hasAttachments) features.push('Attachments');
    features.push(`${Math.floor(maxContext / 1000)}K context`);
    
    return features;
  };

  const features = getModelFeatures();

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300 hover:shadow-md transition-shadow">
      <div className="card-body">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className="card-title text-lg">{provider.name}</h3>
            <div className="flex items-center space-x-2 mt-1">
              <Badge 
                variant={getTypeColor(provider.type)} 
                size="xs"
              >
                {provider.type}
              </Badge>
              <Badge variant="outline" size="xs">
                {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}
              </Badge>
            </div>
          </div>
        </div>
        
        <div className="space-y-3">
          <div className="text-sm">
            <div className="font-medium text-base-content/80">Pricing Range</div>
            <div className="text-base-content/60">
              {formatPrice(minInputPrice)} - {formatPrice(maxOutputPrice)} per 1M tokens
            </div>
          </div>

          <div className="text-sm">
            <div className="font-medium text-base-content/80 mb-1">Features</div>
            <div className="text-base-content/60 text-xs">
              {features.join(' • ')}
            </div>
          </div>

          <div className="text-sm">
            <div className="font-medium text-base-content/80 mb-1">Popular Models</div>
            <div className="space-y-1 text-xs text-base-content/60">
              {provider.models.slice(0, 3).map(model => (
                <div key={model.id} className="flex justify-between">
                  <span>{model.name}</span>
                  <span>{formatPrice(model.cost_per_1m_in)}/{formatPrice(model.cost_per_1m_out)}</span>
                </div>
              ))}
              {provider.models.length > 3 && (
                <div className="text-base-content/40">
                  +{provider.models.length - 3} more model{provider.models.length - 3 !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="card-actions justify-end mt-4">
          <button 
            className="btn btn-primary btn-sm"
            onClick={onAddInstance}
          >
            Add Instance
          </button>
        </div>
      </div>
    </div>
  );
}