# Sample BRD — Retail Web App v2.0

## REQ-101: User login with email and password
As a registered customer, I want to log in with my email and password so that I can access my account.
- The system shall validate the email format before submitting
- Given valid credentials, when the user clicks Sign in, then the dashboard is shown
- Given 3 failed attempts, then the account is locked for 15 minutes

## REQ-102: Card payment at checkout
As a customer, I want to pay by credit card so that I can complete my purchase.
- The system shall accept Visa and Mastercard card numbers
- Given a valid card, when the user clicks Pay, then a payment confirmation is shown
- The system shall reject expired cards with a clear error

## REQ-103: Product search
As a visitor, I want to search products by name so that I can find items quickly.
- Search results should show matching products within 2 seconds
- Given no matches, then a "no results" message is shown
