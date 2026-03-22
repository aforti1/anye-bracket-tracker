@echo off
echo Starting 10 parallel scoring sessions...
echo.

REM Men's — 5 windows
start "MENS 1/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT score_all_games_batch(21001, 221001);"
start "MENS 2/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT score_all_games_batch(221001, 421001);"
start "MENS 3/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT score_all_games_batch(421001, 621001);"
start "MENS 4/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT score_all_games_batch(621001, 821001);"
start "MENS 5/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT score_all_games_batch(821001, 1021001);"

REM Women's — 5 windows
start "WOMENS 1/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT w_score_all_games_batch(1, 200001);"
start "WOMENS 2/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT w_score_all_games_batch(200001, 400001);"
start "WOMENS 3/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT w_score_all_games_batch(400001, 600001);"
start "WOMENS 4/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT w_score_all_games_batch(600001, 800001);"
start "WOMENS 5/5" psql "postgresql://postgres.lbmtcfxjqgauevmsjplr:Broadneck2021@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -c "SELECT w_score_all_games_batch(800001, 1000001);"

echo.
echo All 10 windows launched. Each window closes when done.
echo Check results after all windows close.
pause