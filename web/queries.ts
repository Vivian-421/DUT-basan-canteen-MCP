import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  QueryKeys,
  MutationKeys,
  canteenPublicRequest,
  CanteenPublicApiError,
} from './api';
import type {
  CanteenPublicProfile,
  CanteenPublicStatus,
  CanteenPublicConnection,
} from './api';

export function usePublicCanteen() {
  const cache = useQueryClient();
  const refresh = () => cache.invalidateQueries([QueryKeys.canteenPublicProfile]);
  const status = useQuery([QueryKeys.canteenPublicStatus], () =>
    canteenPublicRequest<CanteenPublicStatus>('status'),
  );
  const profile = useQuery(
    [QueryKeys.canteenPublicProfile],
    async () => {
      try {
        return await canteenPublicRequest<CanteenPublicProfile>('profile');
      } catch (error) {
        if (error instanceof CanteenPublicApiError && error.code === 'sign_in_required')
          return null;
        throw error;
      }
    },
    { retry: false },
  );
  const code = useMutation([MutationKeys.canteenPublicCode], (email: string) =>
    canteenPublicRequest('code', 'POST', { email }),
  );
  const verify = useMutation(
    [MutationKeys.canteenPublicVerify],
    (input: { email: string; code: string }) => canteenPublicRequest('verify', 'POST', input),
    { onSuccess: refresh },
  );
  const connection = useMutation(
    [MutationKeys.canteenPublicConnection],
    (name: string) =>
      canteenPublicRequest<CanteenPublicConnection>('connections', 'POST', { name }),
    { onSuccess: refresh },
  );
  const revoke = useMutation(
    [MutationKeys.canteenPublicRevoke],
    () => canteenPublicRequest('connections', 'DELETE'),
    { onSuccess: refresh },
  );
  const logout = useMutation(
    [MutationKeys.canteenPublicLogout],
    () => canteenPublicRequest('logout', 'POST'),
    {
      onSuccess: () => {
        cache.setQueryData([QueryKeys.canteenPublicProfile], null);
        connection.reset();
      },
    },
  );
  return { status, profile, code, verify, connection, revoke, logout };
}
