import { createBrowserRouter } from 'react-router-dom';
import { SignIn } from './routes/auth/SignIn';
import { AcceptInvite } from './routes/auth/AcceptInvite';
import { ForgotPassword } from './routes/auth/ForgotPassword';
import { ResetPassword } from './routes/auth/ResetPassword';
import { Home } from './routes/Home';
import { NotFound } from './routes/NotFound';

export const router = createBrowserRouter([
  { path: '/auth/sign-in', element: <SignIn /> },
  { path: '/auth/accept-invite/:id', element: <AcceptInvite /> },
  { path: '/auth/forgot', element: <ForgotPassword /> },
  { path: '/auth/reset', element: <ResetPassword /> },
  { path: '/', element: <Home /> },
  { path: '*', element: <NotFound /> },
]);
