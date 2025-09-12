// ABOUTME: Tests for persona catalog API endpoint (GET /api/persona/catalog)
// ABOUTME: Verifies persona listing with real PersonaRegistry implementation

import { describe, it, expect } from 'vitest';
import { loader } from '@/app/routes/api.persona.catalog';
import { parseResponse } from '@/lib/serialization';
import { createLoaderArgs } from '@/test-utils/route-test-helpers';
import type { PersonaCatalogResponse } from '@/app/routes/api.persona.catalog';
import { setupWebTest } from '@/test-utils/web-test-setup';

describe('Persona Catalog API', () => {
  const _tempContext = setupWebTest();

  describe('GET /api/persona/catalog', () => {
    it('should return personas from registry', async () => {
      const mockRequest = new Request('http://localhost/api/persona/catalog');
      const response = await loader(createLoaderArgs(mockRequest, {}));
      const data = await parseResponse<PersonaCatalogResponse>(response);

      expect(response.status).toBe(200);
      expect(data.personas).toBeDefined();
      expect(Array.isArray(data.personas)).toBe(true);
    });

    it('should return persona objects with correct structure', async () => {
      const mockRequest = new Request('http://localhost/api/persona/catalog');
      const response = await loader(createLoaderArgs(mockRequest, {}));
      const data = await parseResponse<PersonaCatalogResponse>(response);

      expect(data.personas.length).toBeGreaterThan(0);

      const persona = data.personas[0];
      expect(persona).toHaveProperty('name');
      expect(persona).toHaveProperty('isUserDefined');
      expect(persona).toHaveProperty('path');
      expect(typeof persona.name).toBe('string');
      expect(typeof persona.isUserDefined).toBe('boolean');
      expect(typeof persona.path).toBe('string');
    });
  });
});
