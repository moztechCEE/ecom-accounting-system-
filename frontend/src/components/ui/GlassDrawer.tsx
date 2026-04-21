import React, { useState, useEffect } from 'react';
import { Drawer, DrawerProps } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { GlassButton } from './GlassButton';

interface GlassDrawerProps extends DrawerProps {
  children: React.ReactNode;
}

export const GlassDrawer: React.FC<GlassDrawerProps> = ({ 
  children, 
  title, 
  onClose, 
  footer,
  width = 380,
  ...props 
}) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const drawerWidth = isMobile ? '100%' : width;

  return (
    <Drawer
      {...props}
      width={drawerWidth}
      onClose={onClose}
      closeIcon={null}
      title={null} // We'll render a custom header
      footer={null} // We'll render a custom footer
      styles={{
        mask: {
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          backdropFilter: 'blur(4px)',
        },
        wrapper: {
          boxShadow: 'none',
        },
        content: {
          backgroundColor: 'transparent',
          boxShadow: 'none',
          padding: 0,
        },
        body: {
          padding: 0,
          backgroundColor: 'transparent',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }
      }}
      rootClassName="glass-drawer-root"
    >
      <div className="h-full flex flex-col bg-white/40 backdrop-blur-2xl border-l border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.08)] rounded-l-3xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-6 border-b border-white/20 shrink-0">
          <div className="min-w-0 flex-1 text-lg font-semibold text-slate-800">{title}</div>
          <GlassButton 
            onClick={onClose as any}
            className="!p-2 !h-8 !w-8 shrink-0 flex items-center justify-center rounded-full border-none bg-white/20 hover:bg-white/40"
          >
            <CloseOutlined className="text-slate-600" />
          </GlassButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="p-4 border-t border-white/20 bg-white/10 shrink-0 rounded-bl-3xl">
            {footer}
          </div>
        )}
      </div>
    </Drawer>
  );
};

export const GlassDrawerSection: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => {
  return (
    <div className={`rounded-2xl bg-white/30 border border-white/10 p-4 mb-4 ${className}`}>
      {children}
    </div>
  );
};
