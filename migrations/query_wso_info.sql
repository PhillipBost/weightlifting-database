-- Query usaw_wso_information to get the correct WSO mappings
SELECT wso_name,
    state,
    region,
    notes
FROM public.usaw_wso_information
ORDER BY wso_name;