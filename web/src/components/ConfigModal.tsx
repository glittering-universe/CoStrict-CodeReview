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
    { id: 'general', label: '常规设置', icon: Settings },
    { id: 'api', label: 'API 配置', icon: Key },
    { id: 'environment', label: '环境', icon: Globe },
    { id: 'advanced', label: '高级设置', icon: Terminal },
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
                      <label className="settings-label">语言</label>
                      <p className="settings-description">
                        选择界面和审查的语言。
                      </p>
                    </div>
                    <div className="settings-control">
                      <select className="settings-select">
                        <option>中文</option>
                        <option>English</option>
                        <option>Japanese</option>
                      </select>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label">主题</label>
                      <p className="settings-description">
                        选择您喜欢的视觉主题。
                      </p>
                    </div>
                    <div className="settings-control">
                      <select className="settings-select">
                        <option>深色</option>
                        <option>浅色</option>
                        <option>系统</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'api' && (
                <>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label">API 密钥</label>
                      <p className="settings-description">
                        您的 OpenAI 或兼容的 API 密钥。
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
                      <label className="settings-label">基础 URL</label>
                      <p className="settings-description">
                        覆盖默认的 API 端点。
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
                    <label className="settings-label">环境</label>
                    <p className="settings-description">
                      选择执行环境。
                    </p>
                  </div>
                  <div className="settings-control">
                    <select
                      value={localConfig.environment}
                      onChange={(e) => handleChange('environment', e.target.value)}
                      className="settings-select"
                    >
                      <option value="local">本地</option>
                      <option value="production">生产</option>
                      <option value="staging">预发布</option>
                      <option value="development">开发</option>
                    </select>
                  </div>
                </div>
              )}

              {activeTab === 'advanced' && (
                <div className="settings-row">
                  <div className="settings-info">
                    <label className="settings-label">调试模式</label>
                    <p className="settings-description">
                      启用详细日志记录以进行故障排除。
                    </p>
                  </div>
                  <div className="settings-control">
                    <select className="settings-select">
                      <option>关闭</option>
                      <option>开启</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="settings-footer">
                <button className="settings-primary-btn" onClick={onClose}>
                  保存并关闭
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
