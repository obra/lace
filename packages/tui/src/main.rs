use lace_tui::args::Args;

fn main() -> std::io::Result<()> {
    let args = match Args::parse(std::env::args_os().skip(1)) {
        Ok(args) => args,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(2);
        }
    };

    if args.help {
        print!("{}", lace_tui::args::help_text());
        return Ok(());
    }

    lace_tui::run(args)
}
