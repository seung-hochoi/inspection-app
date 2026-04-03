import { render, screen } from '@testing-library/react';
import App from './App';

test('renders inspection app tab navigation', () => {
  render(<App />);
  // Verify the three main tabs are present
  const tabs = screen.getAllByText(/검품/);
  expect(tabs.length).toBeGreaterThan(0);
  expect(screen.getAllByText(/내역/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/통계/).length).toBeGreaterThan(0);
});
