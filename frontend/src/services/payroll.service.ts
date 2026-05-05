import api from "./api";
import {
  AuditLogEntry,
  Employee,
  EmployeeOnboardingDocument,
  EmployeeLoginAccountResult,
  Department,
  PayrollRun,
  PayrollRunPrecheckResult,
  PaginatedResult,
  BankAccount,
  PayrollSettings,
} from "../types";
import { resolveEntityId } from "./entities.service";

const triggerFileDownload = (blob: Blob, fallbackFilename: string) => {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
};

export const payrollService = {
  // Employees
  getEmployees: async (page = 1, limit = 20) => {
    const response = await api.get<PaginatedResult<Employee> | Employee[]>(
      "/payroll/employees",
      {
        params: { page, limit },
      },
    );
    if (Array.isArray(response.data)) {
      return {
        items: response.data,
        meta: {
          total: response.data.length,
          page,
          limit,
          totalPages: 1,
        },
      };
    }
    return response.data;
  },

  createEmployee: async (data: Partial<Employee>) => {
    const response = await api.post<Employee>("/payroll/employees", data);
    return response.data;
  },

  updateEmployee: async (id: string, data: Partial<Employee>) => {
    const response = await api.patch<Employee>(
      `/payroll/employees/${id}`,
      data,
    );
    return response.data;
  },

  getEmployee: async (id: string) => {
    const response = await api.get<Employee>(`/payroll/employees/${id}`);
    return response.data;
  },

  createEmployeeLoginAccount: async (
    id: string,
    data: { email: string; password?: string },
  ) => {
    const response = await api.post<EmployeeLoginAccountResult>(
      `/payroll/employees/${id}/login-account`,
      data,
    );
    return response.data;
  },

  uploadEmployeeOnboardingDocument: async (
    employeeId: string,
    docType: EmployeeOnboardingDocument["docType"],
    file: File,
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await api.post<EmployeeOnboardingDocument>(
      `/payroll/employees/${employeeId}/onboarding-documents/${docType}/upload`,
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
    return response.data;
  },

  updateEmployeeOnboardingDocumentStatus: async (
    employeeId: string,
    docType: EmployeeOnboardingDocument["docType"],
    data: {
      status: EmployeeOnboardingDocument["status"];
      clearFile?: boolean;
    },
  ) => {
    const response = await api.patch<EmployeeOnboardingDocument>(
      `/payroll/employees/${employeeId}/onboarding-documents/${docType}/status`,
      data,
    );
    return response.data;
  },

  downloadEmployeeOnboardingDocument: async (
    employeeId: string,
    docType: EmployeeOnboardingDocument["docType"],
  ) => {
    const response = await api.get<Blob>(
      `/payroll/employees/${employeeId}/onboarding-documents/${docType}/download`,
      {
        responseType: "blob",
      },
    );
    triggerFileDownload(response.data, `${employeeId}-${docType}`);
  },

  // Departments (Assuming they are managed under payroll or entities)
  // If there is no specific controller, we might need to use a generic one or add it.
  // Based on schema, Department is a model. I'll assume an endpoint exists or I'll mock it for now.
  getDepartments: async (entityId?: string) => {
    const effectiveEntityId = await resolveEntityId(entityId);
    const response = await api.get<Department[]>("/payroll/departments", {
      params: { entityId: effectiveEntityId },
    });
    return response.data;
  },

  createDepartment: async (data: Partial<Department> & { entityId?: string }) => {
    const effectiveEntityId = await resolveEntityId(data.entityId);
    const response = await api.post<Department>("/payroll/departments", {
      ...data,
      entityId: effectiveEntityId,
    });
    return response.data;
  },

  updateDepartment: async (id: string, data: Partial<Department>) => {
    const response = await api.patch<Department>(
      `/payroll/departments/${id}`,
      data,
    );
    return response.data;
  },

  // Payroll Runs
  getPayrollRuns: async (page = 1, limit = 20) => {
    const response = await api.get<PaginatedResult<PayrollRun> | PayrollRun[]>(
      "/payroll/runs",
      {
        params: { page, limit },
      },
    );
    if (Array.isArray(response.data)) {
      return {
        items: response.data,
        meta: {
          total: response.data.length,
          page,
          limit,
          totalPages: 1,
        },
      };
    }
    return response.data;
  },

  createPayrollRun: async (data: Partial<PayrollRun>) => {
    const response = await api.post<PayrollRun>("/payroll/runs", data);
    return response.data;
  },

  previewPayrollRunWarnings: async (data: {
    entityId?: string;
    periodStart: string;
    periodEnd: string;
    payDate?: string;
  }) => {
    const response = await api.post<PayrollRunPrecheckResult>(
      "/payroll/runs/precheck",
      data,
    );
    return response.data;
  },

  getPayrollRun: async (id: string) => {
    const response = await api.get<PayrollRun>(`/payroll/runs/${id}`);
    return response.data;
  },

  getPayrollRunAuditLogs: async (id: string) => {
    const response = await api.get<AuditLogEntry[]>(`/payroll/runs/${id}/audit-logs`);
    return response.data;
  },

  getMyPayrollRuns: async () => {
    const response = await api.get<PayrollRun[]>("/payroll/my/runs");
    return response.data;
  },

  getMyPayrollRun: async (id: string) => {
    const response = await api.get<PayrollRun>(`/payroll/my/runs/${id}`);
    return response.data;
  },

  downloadMyPayrollRunPdf: async (id: string) => {
    const response = await api.get<Blob>(`/payroll/my/runs/${id}/pdf`, {
      responseType: "blob",
    });
    triggerFileDownload(response.data, `payslip-${id}.pdf`);
  },

  getBankAccounts: async () => {
    const response = await api.get<BankAccount[]>("/payroll/bank-accounts");
    return response.data;
  },

  getPayrollSettings: async () => {
    const response = await api.get<PayrollSettings>("/payroll/settings");
    return response.data;
  },

  updatePayrollSettings: async (data: Partial<PayrollSettings>) => {
    const response = await api.patch<PayrollSettings>(
      "/payroll/settings",
      data,
    );
    return response.data;
  },

  submitPayrollRun: async (id: string) => {
    const response = await api.post<PayrollRun>(`/payroll/runs/${id}/submit`);
    return response.data;
  },

  approvePayrollRun: async (id: string) => {
    const response = await api.post<PayrollRun>(`/payroll/runs/${id}/approve`);
    return response.data;
  },

  postPayrollRun: async (id: string) => {
    const response = await api.post<PayrollRun>(`/payroll/runs/${id}/post`);
    return response.data;
  },

  payPayrollRun: async (
    id: string,
    data: { bankAccountId: string; paidAt?: string },
  ) => {
    const response = await api.post<PayrollRun>(
      `/payroll/runs/${id}/pay`,
      data,
    );
    return response.data;
  },
};
