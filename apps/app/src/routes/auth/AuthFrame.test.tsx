import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthFrame } from './AuthFrame';

describe('AuthFrame', () => {
  it('wraps the form in a main landmark with the brand panel hidden from assistive tech', () => {
    render(
      <AuthFrame>
        <h1>Sign in to Boogbe</h1>
      </AuthFrame>,
    );
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Sign in to Boogbe' }));
    expect(screen.getAllByRole('heading')).toHaveLength(1); // brand panel adds no heading
    expect(screen.getByText('Your shortlets, at home.').closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
