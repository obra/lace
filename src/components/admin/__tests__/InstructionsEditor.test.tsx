// ABOUTME: Tests for InstructionsEditor component
// ABOUTME: Validates core functionality like editing, saving, and template handling

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InstructionsEditor } from '../InstructionsEditor';

describe('InstructionsEditor', () => {
  const mockOnSave = vi.fn();
  const mockOnLoad = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with default props', () => {
    render(<InstructionsEditor />);
    
    expect(screen.getByText('Instructions Editor')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your instructions here...')).toBeInTheDocument();
  });

  it('renders with custom title and placeholder', () => {
    render(
      <InstructionsEditor 
        title="Custom Title"
        placeholder="Custom placeholder"
      />
    );
    
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
  });

  it('handles content changes', async () => {
    render(<InstructionsEditor />);
    
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'New content' } });
    
    expect(textarea).toHaveValue('New content');
    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });

  it('calls onSave when save button is clicked', async () => {
    render(<InstructionsEditor onSave={mockOnSave} />);
    
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Test content' } });
    
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith('Test content');
    });
  });

  it('calls onLoad on mount', async () => {
    mockOnLoad.mockResolvedValue('Loaded content');
    
    render(<InstructionsEditor onLoad={mockOnLoad} />);
    
    await waitFor(() => {
      expect(mockOnLoad).toHaveBeenCalled();
    });
  });

  it('handles loading state', async () => {
    mockOnLoad.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(<InstructionsEditor onLoad={mockOnLoad} />);
    
    // Should show loading state
    await waitFor(() => {
      expect(mockOnLoad).toHaveBeenCalled();
    });
  });

  it('handles save errors', async () => {
    mockOnSave.mockRejectedValue(new Error('Save failed'));
    
    render(<InstructionsEditor onSave={mockOnSave} />);
    
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Test content' } });
    
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument();
    });
  });

  it('handles keyboard shortcuts', () => {
    render(<InstructionsEditor onSave={mockOnSave} />);
    
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Test content' } });
    
    // Test Ctrl+S for save
    fireEvent.keyDown(textarea, { key: 's', ctrlKey: true });
    
    expect(mockOnSave).toHaveBeenCalledWith('Test content');
  });

  it('toggles preview mode', () => {
    render(<InstructionsEditor initialContent="# Test Header" />);
    
    const previewButton = screen.getByTitle('Preview Mode');
    fireEvent.click(previewButton);
    
    // Should show preview content
    expect(screen.getByText('Test Header')).toBeInTheDocument();
  });

  it('exports content', () => {
    // Mock URL.createObjectURL and document.createElement
    const mockCreateObjectURL = vi.fn().mockReturnValue('mock-url');
    const mockClick = vi.fn();
    const mockAppendChild = vi.fn();
    const mockRemoveChild = vi.fn();
    
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = vi.fn();
    
    const mockAnchor = {
      click: mockClick,
      href: '',
      download: '',
    };
    
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
    vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild);
    vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild);
    
    render(<InstructionsEditor initialContent="Test content" />);
    
    const exportButton = screen.getByTitle('Export');
    fireEvent.click(exportButton);
    
    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(mockAppendChild).toHaveBeenCalled();
    expect(mockRemoveChild).toHaveBeenCalled();
  });
});