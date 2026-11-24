import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type {
  AgentAppearance,
  AgentRecord,
  CliProviderInfo,
  ProviderId,
} from '../types/office.ts';

interface AddAgentModalProps {
  providers: CliProviderInfo[];
  defaultCwd: string;
  editingAgent?: AgentRecord | null;
  onClose: () => void;
  onSave: (payload: {
    id?: string;
    name: string;
    roleTitle: string;
    provider: ProviderId;
    customCommand?: string;
    cwd: string;
    appearance: AgentAppearance;
  }) => void;
  onDelete?: (agentId: string) => void;
}

const SHIRT_COLORS = ['#e07a5f', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6'];
const HAIR_COLORS = ['#1f2937', '#4a2c2a', '#d97706', '#7c3aed', '#991b1b', '#e5e7eb'];
const SKIN_COLORS = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'];

export const AddAgentModal: React.FC<AddAgentModalProps> = ({
  providers,
  defaultCwd,
  editingAgent,
  onClose,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState(editingAgent?.name || '');
  const [roleTitle, setRoleTitle] = useState(
    editingAgent?.roleTitle || 'Desenvolvedor(a) IA'
  );
  const [provider, setProvider] = useState<ProviderId>(
    editingAgent?.provider ||
      providers.find((p) => p.installed && p.id !== 'demo' && p.id !== 'custom')?.id ||
      'demo'
  );
  const [customCommand, setCustomCommand] = useState(
    editingAgent?.customCommand || 'echo Executando: {prompt}'
  );
  const [cwd, setCwd] = useState(editingAgent?.cwd || defaultCwd);
  const [shirtColor, setShirtColor] = useState(
    editingAgent?.appearance.shirtColor || SHIRT_COLORS[0]
  );
  const [hairColor, setHairColor] = useState(
    editingAgent?.appearance.hairColor || HAIR_COLORS[0]
  );
  const [skinColor, setSkinColor] = useState(
    editingAgent?.appearance.skinColor || SKIN_COLORS[1]
  );
  const [accessory, setAccessory] = useState<AgentAppearance['accessory']>(
    editingAgent?.appearance.accessory || 'none'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      id: editingAgent?.id,
      name: name.trim(),
      roleTitle: roleTitle.trim() || 'Agente IA',
      provider,
      customCommand: provider === 'custom' ? customCommand.trim() : undefined,
      cwd: cwd.trim() || defaultCwd,
      appearance: {
        shirtColor,
        hairColor,
        skinColor,
        pantsColor: '#1e293b',
        accessory,
      },
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{editingAgent ? `Editar ${editingAgent.name}` : 'Novo Agente no Escritório'}</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <label>
              Nome do Personagem
              <input
                type="text"
                placeholder="Ex: Luna, Atlas, Cláudio..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label>
              Papel / Especialidade
              <input
                type="text"
                placeholder="Ex: Frontend, QA, Pesquisador"
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
              />
            </label>
          </div>

          <label>
            Provedor / CLI Local
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.installed ? '✓' : '(não detectado — usa simulação)'}
                </option>
              ))}
            </select>
          </label>

          {provider === 'custom' && (
            <label>
              Comando customizado (use {'{prompt}'})
              <input
                type="text"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                placeholder='Ex: ollama run qwen2.5-coder {prompt}'
              />
            </label>
          )}

          <label>
            Workspace do Agente (diretório de trabalho)
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/home/usuario/meu-projeto"
            />
          </label>

          <div className="appearance-grid">
            <div>
              <span className="field-label">Camiseta</span>
              <div className="swatch-row">
                {SHIRT_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`color-swatch ${shirtColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setShirtColor(c)}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="field-label">Cabelo</span>
              <div className="swatch-row">
                {HAIR_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`color-swatch ${hairColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setHairColor(c)}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="field-label">Tom de Pele</span>
              <div className="swatch-row">
                {SKIN_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`color-swatch ${skinColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setSkinColor(c)}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="field-label">Acessório</span>
              <select
                value={accessory || 'none'}
                onChange={(e) =>
                  setAccessory(e.target.value as AgentAppearance['accessory'])
                }
              >
                <option value="none">Nenhum</option>
                <option value="glasses">Óculos</option>
                <option value="headphones">Fones de ouvido</option>
                <option value="cap">Boné</option>
              </select>
            </div>
          </div>

          <div className="modal-footer">
            {editingAgent && onDelete ? (
              <button
                type="button"
                className="danger-btn ghost"
                onClick={() => {
                  onDelete(editingAgent.id);
                  onClose();
                }}
              >
                <Trash2 size={14} />
                <span>Remover</span>
              </button>
            ) : (
              <span />
            )}
            <div className="modal-footer-right">
              <button type="button" className="secondary-btn" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="primary-btn">
                {editingAgent ? 'Salvar alterações' : 'Adicionar ao Escritório'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
