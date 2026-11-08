const color = (name) => `rgb(var(--${name}) / <alpha-value>)`;
module.exports = {
  content: ['./web/**/*.{html,ts,tsx}'],
  theme: { extend: { colors: {
    surface: { primary: color('surface'), secondary: color('secondary'), hover: color('hover'), submit: color('submit'), 'submit-hover': color('submit-hover') },
    text: { primary: color('text'), secondary: color('muted') },
    border: { light: color('border'), medium: color('border-strong') },
    green: { 400: color('accent'), 500: color('accent'), 600: color('accent'), 700: color('accent') },
    'primary-foreground': color('submit-text'), 'muted-foreground': color('muted'),
  } } },
};
