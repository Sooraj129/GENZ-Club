import { customerRepository } from '../repositories/customerRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { emitEvent } from '../sockets/index.js';
import { conflict, isPgError, notFound, PG } from '../utils/errors.js';

export const customerService = {
  /**
   * Creates a customer. A duplicate phone number is reported with the existing
   * record attached so the UI can offer to start a session for them instead.
   */
  async create(input: { name: string; phone: string; email: string | null }) {
    const existing = await customerRepository.findByPhone(input.phone);
    if (existing) throw conflict('Customer already exists', { customer: existing });
    try {
      const customer = await customerRepository.create(input);
      emitEvent('customer:updated', { customer_id: customer.id });
      return customer;
    } catch (err) {
      // Lost a race with another request creating the same phone number.
      if (isPgError(err, PG.UNIQUE_VIOLATION)) {
        const winner = await customerRepository.findByPhone(input.phone);
        throw conflict('Customer already exists', { customer: winner });
      }
      throw err;
    }
  },

  list(search: string | undefined, page: number, pageSize: number) {
    return customerRepository.list({ search, limit: pageSize, offset: (page - 1) * pageSize });
  },

  search(term: string) {
    return customerRepository.search(term, 10);
  },

  async getProfile(id: string) {
    const customer = await customerRepository.findWithStats(id);
    if (!customer) throw notFound('Customer not found');
    return customer;
  },

  async history(id: string, page: number, pageSize: number) {
    return sessionRepository.list({ customerId: id }, pageSize, (page - 1) * pageSize);
  },

  async update(id: string, input: Partial<{ name: string; phone: string; email: string | null }>) {
    if (input.phone) {
      const other = await customerRepository.findByPhone(input.phone);
      if (other && other.id !== id) throw conflict('Another customer already uses this phone number', { customer: other });
    }
    try {
      const customer = await customerRepository.update(id, input);
      if (!customer) throw notFound('Customer not found');
      emitEvent('customer:updated', { customer_id: id });
      return customer;
    } catch (err) {
      if (isPgError(err, PG.UNIQUE_VIOLATION)) throw conflict('Another customer already uses this phone number');
      throw err;
    }
  },
};
