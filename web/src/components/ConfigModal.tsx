import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, Key } from 'lucide-react';

export interface ConfigSettings {
  apiKey: string;
  environment: string; 
  baseUrl: string;
  language: 'zh' | 'en';
  theme: 'dark' | 'light';
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

  const t = (text: string) => {
    const isZh = localConfig.language === 'zh';
    const dict: Record<string, string> = {
      'General': isZh ? '通用设置' : 'General',
      'API Configuration': isZh ? 'API 配置' : 'API Configuration',
      'Language': isZh ? '语言' : 'Language',
      'Select the language...': isZh ? '选择界面显示语言。' : 'Select the language for the interface and reviews.',
      'Theme': isZh ? '主题' : 'Theme',
      'Choose your preferred...': isZh ? '选择您喜欢的视觉主题。' : 'Choose your preferred visual theme.',
      'API Key': isZh ? 'API 密钥' : 'API Key',
      'Your OpenAI...': isZh ? '您的 OpenAI 或兼容的 API 密钥。' : 'Your OpenAI or compatible API key.',
      'Base URL': isZh ? 'Base URL' : 'Base URL',
      'Override the default...': isZh ? '覆盖默认的 API 地址。' : 'Override the default API endpoint.',
      'Save & Close': isZh ? '保存并关闭' : 'Save & Close',
      // Theme Options
      'Dark (Deep)': isZh ? '深色 (Deep)' : 'Dark (Deep)',
      'Light (White)': isZh ? '白色 (White)' : 'Light (White)',
    };
    return dict[text] || text;
  };

  const navItems = [
    { id: 'general', label: t('General'), icon: Settings },
    { id: 'api', label: t('API Configuration'), icon: Key },
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
                      <label className="settings-label">{t('Language')}</label>
                      <p className="settings-description">
                        {t('Select the language...')}
                      </p>
                    </div>
                    <div className="settings-control">
                      <select 
                        className="settings-select"
                        value={localConfig.language}
                        onChange={(e) => handleChange('language', e.target.value)}
                      >
                        <option value="en">English</option>
                        <option value="zh">中文</option>
                      </select>
                    </div>
                  </div>
                  
                  {/* Theme Selector */}
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label">{t('Theme')}</label>
                      <p className="settings-description">
                        {t('Choose your preferred...')}
                      </p>
                    </div>
                    <div className="settings-control">
                      <select 
                        className="settings-select"
                        value={localConfig.theme}
                        onChange={(e) => handleChange('theme', e.target.value)}
                      >
                        <option value="dark">{t('Dark (Deep)')}</option>
                        <option value="light">{t('Light (White)')}</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'api' && (
                <>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label">{t('API Key')}</label>
                      <p className="settings-description">
                        {t('Your OpenAI...')}
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
                      <label className="settings-label">{t('Base URL')}</label>
                      <p className="settings-description">
                        {t('Override the default...')}
                      </p>
                    </div>
                    <div className="settings-control">
                      <input
                        type="text"
                        value={localConfig.baseUrl}
                        onChange={(e) => handleChange('baseUrl', e.target.value)}
                        className="settings-input"
                        placeholder="https://open.bigmodel.cn/api/paas/v4/"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="settings-footer">
                <button className="settings-primary-btn" onClick={onClose}>
                  {t('Save & Close')}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};