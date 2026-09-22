// Local-only fixture: no account is created and no real API is contacted.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../src/index.css'
import { AuthProvider } from '../src/contexts/AuthContext'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import { authService } from '../src/services/auth.service'
import { webSocketService } from '../src/services/websocket.service'
import { usersService } from '../src/services/users.service'
import { rolesService } from '../src/services/roles.service'
import { permissionsService } from '../src/services/permissions.service'
import api from '../src/services/api'
import AccessControlPage from '../src/pages/AccessControlPage'

authService.getToken = () => 'local-fixture-only'
authService.getCurrentUser = async () => ({ id: 'fixture', name: '測試', email: 'fixture@example.invalid', roles: ['SUPER_ADMIN'], permissions: ['access_control:read', 'access_control:update'] })
webSocketService.connect = () => {}
api.defaults.adapter = async (config) => ({ data: [], status: 200, statusText: 'OK', headers: {}, config })
rolesService.list = async () => []
permissionsService.list = async () => []
usersService.list = async () => ({ items: [], meta: { total: 0, page: 1, limit: 25, totalPages: 1 } })
let attempts = 0
usersService.create = async () => {
  document.getElementById('fixture-attempts')!.textContent = `測試送出次數：${++attempts}`
  await new Promise((resolve) => setTimeout(resolve, 800))
  throw { response: { status: 409, data: { message: 'Email fixture@example.invalid already exists' } } }
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><AuthProvider><MemoryRouter><p id="fixture-attempts">測試送出次數：0</p><AccessControlPage /></MemoryRouter></AuthProvider></ThemeProvider>)
