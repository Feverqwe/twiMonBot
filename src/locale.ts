import en from "./locale/en";

class Locale {
  getMessage(messageName: keyof typeof languages[keyof typeof languages], variables?: Record<string, number | string>) {
    const message = languages.en[messageName];
    return message.replace(/\{([^}]+)}/g, (template) => {
      const variable = template.slice(1, -1);
      return String(variables && variables[variable] || variable);
    });
  }

  m = this.getMessage;
}

const languages = {
  en,
};

export const locale = new Locale();

export default Locale;