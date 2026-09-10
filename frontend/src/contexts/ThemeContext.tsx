import React, { createContext, useContext, useState, useEffect } from 'react'
import { ConfigProvider, theme } from 'antd'
import { PRODUCT } from '../config/product'

type ThemeMode = 'light' | 'dark'
export type PrimaryColor = 'blue' | 'purple' | 'green' | 'orange' | 'black'

interface ThemeContextType {
  mode: ThemeMode
  toggleMode: () => void
  primaryColor: PrimaryColor
  setPrimaryColor: (color: PrimaryColor) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

const COLOR_MAP = {
  blue: PRODUCT.primary,
  purple: '#722ed1',
  green: '#52c41a',
  orange: '#fa8c16',
  black: '#000000',
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>('light')
  const [primaryColor, setPrimaryColor] = useState<PrimaryColor>('blue')

  useEffect(() => {
    // Apply dark mode class to body
    if (mode === 'dark') {
      document.body.classList.add('dark')
    } else {
      document.body.classList.remove('dark')
    }
  }, [mode])

  const toggleMode = () => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  return (
    <ThemeContext.Provider value={{ mode, toggleMode, primaryColor, setPrimaryColor }}>
      <ConfigProvider
        theme={{
          algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: COLOR_MAP[primaryColor],
            borderRadius: 8,
            controlHeight: 36,
            controlHeightLG: 44,
            controlHeightSM: 28,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          },
          components: {
            Button: {
              controlHeight: 36,
              borderRadius: 8,
            },
            Card: {
              borderRadiusLG: 12,
            },
            Input: {
              controlHeight: 36,
              borderRadius: 8,
            },
            Select: {
              controlHeight: 36,
              borderRadius: 8,
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
