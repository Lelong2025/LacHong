using Microsoft.Extensions.Configuration;
using System.Net;
using System.Net.Mail;

public class EmailService
{
    private readonly IConfiguration _config;

    public EmailService(IConfiguration config)
    {
        _config = config;
    }

    public async Task SendAsync(string to, string subject, string body)
    {
        string email = _config["GmailSettings:Mail"];
        string password = _config["GmailSettings:Password"];
        string host = _config["GmailSettings:Host"];


        var message = new MailMessage(email, to, subject, body);
        message.IsBodyHtml = true;

        using var client = new SmtpClient("smtp.gmail.com", 587)
        {
            EnableSsl = true,
            Credentials = new NetworkCredential(email, password)
        };

        await client.SendMailAsync(message);
    }
}
