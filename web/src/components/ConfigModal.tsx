import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, Globe, Key, Terminal } from 'lucide-react';

export interface ConfigSettings {
  apiKey: string;
  environment: string;
  baseUrl: string;
}

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ConfigSettings;
  onSave: (newConfig: ConfigSettings) => void;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState('general');
  const [localConfig, setLocalConfig] = useState(config);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleChange = (key: string, value: string) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
    onSave(newConfig);
  };

  const navItems = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'api', label: 'API Configuration', icon: Key },
    { id: 'environment', label: 'Environment', icon: Globe },
    { id: 'advanced', label: 'Advanced', icon: Terminal },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="modal-overlay" onClick={onClose}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="settings-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar */}
            <div className="settings-sidebar">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <item.icon size={18} />
                  {item.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="settings-content">
              <div className="settings-header">
                <h2 className="settings-title">
                  {navItems.find((i) => i.id === activeTab)?.label}
                </h2>
                <button className="close-btn" aria-label="Close settings" onClick={onClose}>
                  <X size={20} />
                </button>
              </div>

              {activeTab === 'general' && (
                <>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label">Language</label>
                      <p className="settings-description">
                        Select the language for the interface and reviews.
                      </p>
                    </div>
                    <div className="settings-control">
                      <select className="settings-select">
                        <option>English</option>
                        <option>Chinese</option>
                        <option>Japanese</option>
                      </select>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label">Theme</label>
                      <p className="settings-description">
                        Choose your preferred visual theme.
                      </p>
                    </div>
                    <div className="settings-control">
                      <select className="settings-select">
                        <option>Dark</option>
                        <option>Light</option>
                        <option>System</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'api' && (
                <>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label">API Key</label>
                      <p className="settings-description">
                        Your OpenAI or compatible API key.
                      </p>
                    </div>
                    <div className="settings-control">
                      <input
                        type="password"
                        value={localConfig.apiKey}
                        onChange={(e) => handleChange('apiKey', e.target.value)}
                        className="settings-input"
                        placeholder="sk-..."
                      />
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label">Base URL</label>
                      <p className="settings-description">
                        Override the default API endpoint.
                      </p>
                    </div>
                    <div className="settings-control">
                      <input
                        type="text"
                        value={localConfig.baseUrl}
                        onChange={(e) => handleChange('baseUrl', e.target.value)}
                        className="settings-input"
                        placeholder="https://api.openai.com/v1"
                      />
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'environment' && (
                <div className="settings-row">
                  <div className="settings-info">
                    <label className="settings-label">Environment</label>
                    <p className="settings-description">
                      Select the execution environment.
                    </p>
                  </div>
                  <div className="settings-control">
                    <select
                      value={localConfig.environment}
                      onChange={(e) => handleChange('environment', e.target.value)}
                      className="settings-select"
                    >
                      <option value="local">Local</option>
                      <option value="production">Production</option>
                      <option value="staging">Staging</option>
                      <option value="development">Development</option>
                    </select>
                  </div>
                </div>
              )}

              {activeTab === 'advanced' && (
                <div className="settings-row">
                  <div className="settings-info">
                    <label className="settings-label">Debug Mode</label>
                    <p className="settings-description">
                      Enable verbose logging for troubleshooting.
                    </p>
                  </div>
                  <div className="settings-control">
                    <select className="settings-select">
                      <option>Off</option>
                      <option>On</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="settings-footer">
                <button className="settings-primary-btn" onClick={onClose}>
                  Save & Close
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
