import { apiRequest } from '../auth/api';

export interface DemoRequestInput {
  name: string;
  email: string;
  company: string;
  message?: string;
  source?: 'landing' | 'contact';
}

export interface DemoRequestResponse {
  id: string;
  reference: string;
  message: string;
}

/**
 * Public lead capture. This is the same-origin API used by the landing page; it does not require a
 * session and never returns another company's data. The server applies validation, rate limiting
 * and a generic response.
 */
export function submitDemoRequest(input: DemoRequestInput): Promise<DemoRequestResponse> {
  return apiRequest<DemoRequestResponse>('/public/demo-requests', {
    method: 'POST',
    body: input,
    authFailureEvent: false,
  });
}
