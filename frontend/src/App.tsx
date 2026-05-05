import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AIProvider } from './contexts/AIContext'
import DashboardLayout from './components/DashboardLayout'
import ProtectedRoute from './components/ProtectedRoute'
import PermissionRoute from './components/PermissionRoute'
import LoginPage from './pages/LoginPage'
import ForcePasswordChangePage from './pages/ForcePasswordChangePage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import DashboardPage from './pages/DashboardPage'
import AccountsPage from './pages/AccountsPage'
import JournalEntriesPage from './pages/JournalEntriesPage'
import AccountingPeriodsPage from './pages/AccountingPeriodsPage'
import AccountingWorkbenchPage from './pages/AccountingWorkbenchPage'
import ReconciliationCenterPage from './pages/ReconciliationCenterPage'
import SalesPage from './pages/SalesPage'
import ReportsPage from './pages/ReportsPage'
import VendorsPage from './pages/VendorsPage'
import AccessControlPage from './pages/AccessControlPage'
import ArInvoicesPage from './pages/ArInvoicesPage'
import ApInvoicesPage from './pages/ApInvoicesPage'
import BankingPage from './pages/BankingPage'
import PayrollPage from './pages/PayrollPage'
import EmployeesPage from './pages/EmployeesPage'
import ExpenseRequestsPage from './pages/ExpenseRequestsPage'
import ExpenseReviewCenterPage from './pages/ExpenseReviewCenterPage'
import AccountsPayablePage from './pages/AccountsPayablePage'
import ReimbursementItemsAdminPage from './pages/ReimbursementItemsAdminPage'
import ImportPage from './pages/ImportPage'
import SystemSettingsPage from './pages/SystemSettingsPage'
import EmployeeDashboardPage from './pages/attendance/EmployeeDashboardPage'
import LeaveRequestPage from './pages/attendance/LeaveRequestPage'
import AttendanceAdminPage from './pages/attendance/AttendanceAdminPage'
import ProductsPage from './pages/ProductsPage'
import PurchaseOrdersPage from './pages/PurchaseOrdersPage'
import AssemblyPage from './pages/AssemblyPage'
import CustomersPage from './pages/CustomersPage'
import ProfilePage from './pages/ProfilePage'

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AIProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
            
            <Route path="/" element={<ProtectedRoute />}>
              <Route path="auth/change-password" element={<ForcePasswordChangePage />} />
              <Route element={<DashboardLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="reconciliation" element={<ReconciliationCenterPage />} />
                <Route path="accounting/workbench" element={<PermissionRoute anyPermissions={['accounts:read', 'journal_entries:read']}><AccountingWorkbenchPage /></PermissionRoute>} />
                <Route path="accounting/accounts" element={<PermissionRoute anyPermissions={['accounts:read']}><AccountsPage /></PermissionRoute>} />
                <Route path="accounting/journals" element={<PermissionRoute anyPermissions={['journal_entries:read']}><JournalEntriesPage /></PermissionRoute>} />
                <Route path="accounting/periods" element={<PermissionRoute anyPermissions={['accounts:read']}><AccountingPeriodsPage /></PermissionRoute>} />
                <Route path="sales/orders" element={<PermissionRoute anyPermissions={['sales_orders:read']}><SalesPage /></PermissionRoute>} />
                <Route path="reports" element={<PermissionRoute anyPermissions={['reports:read']}><ReportsPage /></PermissionRoute>} />
                <Route path="vendors" element={<PermissionRoute anyPermissions={['purchase_orders:read', 'accounts:read']}><VendorsPage /></PermissionRoute>} />
                
                {/* New Module Routes */}
                <Route path="sales/invoices" element={<PermissionRoute anyPermissions={['sales_orders:read', 'accounts:read']}><ArInvoicesPage /></PermissionRoute>} />
                {/* <Route path="purchasing/invoices" element={<ApInvoicesPage />} /> */}
                <Route path="banking" element={<PermissionRoute anyPermissions={['banking:read']}><BankingPage /></PermissionRoute>} />
                <Route path="payroll/runs" element={<PermissionRoute anyPermissions={['payroll_self:read', 'payroll_admin:read']}><PayrollPage /></PermissionRoute>} />
                <Route path="payroll/employees" element={<PermissionRoute anyPermissions={['employees_admin:read']}><EmployeesPage /></PermissionRoute>} />
                <Route path="ap/expenses" element={<ExpenseRequestsPage />} />
                <Route path="ap/expense-review" element={<ExpenseReviewCenterPage />} />
                <Route path="ap/payable" element={<AccountsPayablePage />} />
                <Route path="admin/access-control" element={<PermissionRoute anyPermissions={['access_control:read', 'access_control:update']}><AccessControlPage /></PermissionRoute>} />
                <Route path="admin/reimbursement-items" element={<ReimbursementItemsAdminPage />} />
                <Route path="admin/settings" element={<SystemSettingsPage />} />
                
                {/* Attendance Routes */}
                <Route path="attendance/dashboard" element={<PermissionRoute anyPermissions={['attendance_self:read']}><EmployeeDashboardPage /></PermissionRoute>} />
                <Route path="attendance/leaves" element={<PermissionRoute anyPermissions={['leave_self:read']}><LeaveRequestPage /></PermissionRoute>} />
                <Route path="attendance/admin" element={<PermissionRoute anyPermissions={['attendance_admin:read']}><AttendanceAdminPage /></PermissionRoute>} />

                {/* Supply Chain Routes */}
                <Route path="inventory/products" element={<PermissionRoute anyPermissions={['inventory:read']}><ProductsPage /></PermissionRoute>} />
                <Route path="purchasing/orders" element={<PermissionRoute anyPermissions={['purchase_orders:read']}><PurchaseOrdersPage /></PermissionRoute>} />
                <Route path="manufacturing/assembly" element={<PermissionRoute anyPermissions={['inventory:read']}><AssemblyPage /></PermissionRoute>} />
                <Route path="sales/customers" element={<PermissionRoute anyPermissions={['sales_orders:read']}><CustomersPage /></PermissionRoute>} />

                {/* User Routes */}
                <Route path="profile" element={<PermissionRoute anyPermissions={['profile_self:read']}><ProfilePage /></PermissionRoute>} />

                {/* 電商對帳中心路由（2026-04）*/}
                <Route path="reconciliation" element={<ReconciliationCenterPage />} />

                {/* Placeholder Routes */}
                <Route path="import" element={<ImportPage />} />
              </Route>
            </Route>
            </Routes>
          </AIProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
