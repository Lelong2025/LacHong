using log4net;
using System;

namespace LearnApiNetCore.Helpers
{
    public static class LogHelper
    {
        private static readonly ILog log = LogManager.GetLogger(typeof(LogHelper));

        public static void Info(string message)
        {
            log.Info(message);
        }

        public static void LogException(Exception ex, string where = "")
        {
            log.Error($"Lỗi xảy ra tại: {where}\nMessage: {ex.Message}\nStackTrace: {ex.StackTrace}");
        }
    }
}
