d3.csv("../data/lab3_data.csv")
    .then(data => {
        const columns = data.columns;
        const rowsPerPage = 20;
        let currentPage = 1;
        let ascending = true;
        let sortColumn = null;
        data.forEach(d => {
            d.id = +d.id;
            d.price = +d.price;
            d.rating = +d.rating;
            d.page = +d.page;
        });
        d3.select("#record-count").text(`${data.length} records`);
        const table = d3.select("#data-table");
        const header = table.select("thead").append("tr");
        header.selectAll("th")
            .data(columns)
            .join("th")
            .text(d => d)
            .style("cursor", "pointer")
            .on("click", function(event, column) {
                if (sortColumn === column) {
                    ascending = !ascending;
                } 
                else {
                    sortColumn = column;
                    ascending = true;
                }
                data.sort((a, b) => {
                    if (ascending) {
                        return d3.ascending(
                            a[column],
                            b[column]
                        );
                    }
                    return d3.descending(
                        a[column],
                        b[column]
                    );
                });
                currentPage = 1;
                updateTable();
            });
        function updateTable() {
            const start = (currentPage - 1) * rowsPerPage;
            const end = start + rowsPerPage;
            const pageData = data.slice(start, end);
            table
                .select("tbody")
                .selectAll("tr")
                .data(pageData)
                .join("tr")
                .selectAll("td")
                .data(row =>
                    columns.map(column => row[column])
                )
                .join("td")
                .text(d => d);
            updatePagination();
        }
        function updatePagination() {
            const totalPages = Math.ceil(data.length / rowsPerPage);
            let pagination = d3.select("#pagination");
            if (pagination.empty()) 
                pagination = d3.select("main").append("div").attr("id", "pagination");
            pagination.html("");
            const previousButton = pagination
                .append("button")
                .text("Previous")
                .property(
                    "disabled",
                    currentPage === 1
                )
                .on("click", function() {

                    if (currentPage > 1) {
                        currentPage--;
                        updateTable();
                    }
                });
            pagination
                .append("span")
                .text(
                    ` Page ${currentPage} of ${totalPages} `
                );
            pagination
                .append("button")
                .text("Next")
                .property(
                    "disabled",
                    currentPage === totalPages
                )
                .on("click", function() {
                    if (currentPage < totalPages) {
                        currentPage++;
                        updateTable();
                    }
                });
        }
        updateTable();
    })
    .catch(error => {
        console.error("Error loading CSV:", error);
    });
