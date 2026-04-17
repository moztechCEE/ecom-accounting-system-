import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AIProvider } from './contexts/AIContext'
import DashboardLayout from './components/DashboardLayout'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AccountsPage from './pages/AccountsPage'
import JournalEntriesPage from './pages/JournalEntriesPage'
import AccountingPeriodsPage from './pages/AccountingPeriodsPage'
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
            
            <Route path="/" element={<ProtectedRoute />}>
              <Route element={<DashboardLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="accounting/accounts" element={<AccountsPage />} />
                <Route path="accounting/journals" element={<JournalEntriesPage />} />
                <Route path="accounting/periods" element={<AccountingPeriodsPage />} />
                <Route path="sales/orders" element={<SalesPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="vendors" element={<VendorsPage />} />
                
                {/* New Module Routes */}
                <Route path="sales/invoices" element={<ArInvoicesPage />} />
                {/* <Route path="purchasing/invoices" element={<ApInvoicesPage />} /> */}
                <Route path="banking" element={<BankingPage />} />
                <Route path="payroll/runs" element={<PayrollPage />} />
                <Route path="payroll/employees" element={<EmployeesPage />} />
                <Route path="ap/expenses" element={<ExpenseRequestsPage />} />
                <Route path="ap/expense-review" element={<ExpenseReviewCenterPage />} />
                <Route path="ap/payable" element={<AccountsPayablePage />} />
                <Route path="admin/access-control" element={<AccessControlPage />} />
                <Route path="admin/reimbursement-items" element={<ReimbursementItemsAdminPage />} />
                <Route path="admin/settings" element={<SystemSettingsPage />} />
                
                {/* Attendance Routes */}
                <Route path="attendance/dashboard" element={<EmployeeDashboardPage />} />
                <Route path="attendance/leaves" element={<LeaveRequestPage />} />
                <Route path="attendance/admin" element={<AttendanceAdminPage />} />

                {/* Supply Chain Routes */}
                <Route path="inventory/products" element={<ProductsPage />} />
                <Route path="purchasing/orders" element={<PurchaseOrdersPage />} />
                <Route path="manufacturing/assembly" element={<AssemblyPage />} />
                <Route path="sales/customers" element={<CustomersPage />} />

                {/* User Routes */}
                <Route path="profile" element={<ProfilePage />} />

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
