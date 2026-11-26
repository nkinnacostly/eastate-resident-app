/**
 * The "who to contact" card in a house-billed estate.
 *
 * Two things it used to get wrong: it told tenants their codes were paused
 * (and drafted a text saying so) in estates that never pause codes, and its
 * WhatsApp button linked a locally written number ("082 ...") to nobody.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { LandlordCard, whatsappNumber } from '@/components/landlord-card';

const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
beforeEach(() => open.mockClear());

const card = (codesPaused: boolean, phone = '082 000 0001', currency: string | null = 'ZAR') =>
  render(
    <LandlordCard
      name="Pieter"
      phone={phone}
      email={null}
      estateName="Silver Oaks"
      currency={currency}
      codesPaused={codesPaused}
    />,
  );

describe('what the tenant is told', () => {
  it('does not claim codes are paused when the estate does not pause them', () => {
    card(false);
    expect(screen.queryByText(/codes come back/)).toBeNull();
    fireEvent.press(screen.getByText('Text message'));
    const url = decodeURIComponent(open.mock.calls[0][0] as string);
    expect(url).toContain('Could you settle them?');
    expect(url).not.toMatch(/cannot generate visitor codes/);
  });

  it('says so, and drafts it, when the estate does pause codes', () => {
    card(true);
    expect(screen.getByText(/your codes come back straight away/)).toBeTruthy();
    fireEvent.press(screen.getByText('Text message'));
    expect(decodeURIComponent(open.mock.calls[0][0] as string)).toMatch(
      /I cannot generate visitor codes until they are paid/,
    );
  });
});

describe('WhatsApp', () => {
  it('turns a local South African number into an international one', () => {
    card(false, '082 000 0001', 'ZAR');
    fireEvent.press(screen.getByText('WhatsApp'));
    expect(open).toHaveBeenCalledWith('https://wa.me/27820000001');
  });

  it.each([
    ['+27 82 000 0001', 'ZAR', '27820000001'],
    ['0027 82 000 0001', 'ZAR', '27820000001'],
    ['0803 000 0001', 'NGN', '2348030000001'],
    ['+234 803 000 0001', 'NGN', '2348030000001'],
    ['27820000001', 'ZAR', '27820000001'],
    ['082 000 0001', null, '0820000001'],
  ])('%s billed in %s -> %s', (phone, currency, want) => {
    expect(whatsappNumber(phone, currency)).toBe(want);
  });
});
